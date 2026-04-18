/// <reference lib="webworker" />
/**
 * Pyodide Web Worker: loads Pyodide + pytest on first request, then runs
 * user code + tests in a scratch virtual-FS directory per invocation.
 *
 * The worker is deliberately "one init, many runs" — the runner on the main
 * thread throws away (terminates) and respawns the worker on timeout, so we
 * never need to recover a wedged interpreter from inside the worker itself.
 *
 * Pyodide is loaded from same-origin `/pyodide/` (self-hosted distribution,
 * staged by `scripts/stage-pyodide.mjs`), so there is no CDN dependency at
 * runtime and the Pyodide release doubles as a lockfile.
 */

import type { PytestSummary, WorkerRequest, WorkerResponse } from './protocol'
import harnessSource from './pytest-harness.py?raw'

type PyodideModule = {
	loadPyodide: (options: { indexURL: string }) => Promise<PyodideAPI>
}

type PyodideAPI = {
	loadPackage: (names: string | string[]) => Promise<unknown>
	runPython: (code: string) => unknown
	runPythonAsync: (code: string) => Promise<unknown>
	setStdout: (opts: { batched?: (s: string) => void }) => void
	setStderr: (opts: { batched?: (s: string) => void }) => void
	FS: {
		writeFile: (path: string, data: string) => void
		mkdirTree: (path: string) => void
	}
	globals: {
		get: (name: string) => unknown
		set: (name: string, value: unknown) => void
	}
	toPy: (obj: unknown) => unknown
}

type PyProxy = {
	toJs: (opts?: { dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown }) => unknown
	destroy: () => void
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

const PYODIDE_BASE = '/pyodide/'
const HARNESS_PATH = '/tmp/grind75_harness.py'

let pyodide: PyodideAPI | null = null
let initPromise: Promise<PyodideAPI> | null = null

function post(msg: WorkerResponse): void {
	ctx.postMessage(msg)
}

async function init(requestId: string): Promise<PyodideAPI> {
	if (pyodide) return pyodide
	if (initPromise) return initPromise

	initPromise = (async () => {
		post({
			type: 'init:progress',
			requestId,
			phase: 'loading-pyodide',
			message: 'Loading Python runtime…',
		})
		// Dynamic import of the self-hosted Pyodide module. `@vite-ignore` keeps
		// Vite from trying to resolve the path at build time — it resolves at
		// runtime against the served static asset.
		const mod = (await import(/* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`)) as PyodideModule
		const api = await mod.loadPyodide({ indexURL: PYODIDE_BASE })

		post({
			type: 'init:progress',
			requestId,
			phase: 'loading-pytest',
			message: 'Loading pytest…',
		})
		await api.loadPackage('pytest')

		post({
			type: 'init:progress',
			requestId,
			phase: 'installing-harness',
			message: 'Installing test harness…',
		})
		api.FS.writeFile(HARNESS_PATH, harnessSource)
		api.runPython(
			"import sys\nif '/tmp' not in sys.path: sys.path.insert(0, '/tmp')\nimport grind75_harness",
		)

		pyodide = api
		return api
	})()

	try {
		const api = await initPromise
		post({ type: 'init:ready', requestId })
		return api
	} finally {
		initPromise = null
	}
}

async function run(
	api: PyodideAPI,
	requestId: string,
	code: string,
	tests: string,
	_entryFunction: string,
): Promise<void> {
	let stdout = ''
	let stderr = ''
	api.setStdout({ batched: (s) => (stdout += `${s}\n`) })
	api.setStderr({ batched: (s) => (stderr += `${s}\n`) })

	const runDir = '/home/pyodide/run'
	api.FS.mkdirTree(runDir)
	api.FS.writeFile(`${runDir}/solution.py`, code)
	api.FS.writeFile(`${runDir}/test_problem.py`, tests)

	const started = performance.now()

	// The harness module owns its own collector instance per run. Reset it,
	// then register a fresh collector into pytest's plugin manager at call
	// time via a `-p` flag is awkward — instead, use the `plugins=` kwarg to
	// `pytest.main`, passing the collector object.
	await api.runPythonAsync(`
import os, sys, importlib
import grind75_harness
importlib.reload(grind75_harness)  # fresh module state per run
grind75_harness.reset()

import pytest

# Change into the run dir so pytest discovers test_problem.py; inject the
# solution's directory onto sys.path so \`from solution import ...\` works.
os.chdir(${JSON.stringify(runDir)})
if ${JSON.stringify(runDir)} not in sys.path:
    sys.path.insert(0, ${JSON.stringify(runDir)})

# Drop any stale solution module from a previous run.
for _mod in ('solution', 'test_problem'):
    sys.modules.pop(_mod, None)

_collector = grind75_harness._Collector()
pytest.main(
    ['-q', '--no-header', '-p', 'no:cacheprovider', 'test_problem.py'],
    plugins=[_collector],
)
_RESULT = grind75_harness.result()
`)

	const durationMs = performance.now() - started

	const proxy = api.globals.get('_RESULT') as PyProxy | undefined
	if (!proxy) {
		throw new Error('harness did not produce a result')
	}
	const summary = proxy.toJs({
		dict_converter: (entries) => Object.fromEntries(entries as Iterable<[string, unknown]>),
	}) as PytestSummary
	proxy.destroy()

	post({
		type: 'run:result',
		requestId,
		summary,
		stdout,
		stderr,
		durationMs,
	})
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	void handle(event.data)
})

async function handle(msg: WorkerRequest): Promise<void> {
	try {
		if (msg.type === 'init') {
			await init(msg.requestId)
			return
		}
		if (msg.type === 'reset') {
			// The main thread owns respawn — 'reset' is only here for symmetry.
			pyodide = null
			initPromise = null
			return
		}
		if (msg.type === 'run') {
			const api = await init(msg.requestId)
			await run(api, msg.requestId, msg.code, msg.tests, msg.entryFunction)
			return
		}
	} catch (err) {
		const e = err as Error
		post({
			type: 'error',
			requestId: (msg as { requestId: string }).requestId,
			message: e.message ?? String(err),
			stack: e.stack,
		})
	}
}
