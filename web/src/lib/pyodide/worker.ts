/// <reference lib="webworker" />
/**
 * Pyodide Web Worker: loads Pyodide + pytest on first request, then runs
 * user code + tests in the worker's virtual filesystem on each invocation.
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

/**
 * Per-run stdout/stderr cap. `while True: print('x')` would otherwise grow the
 * buffer until the worker OOMs. 64 KB is generous for pytest output of a
 * small problem and is shipped as a single postMessage on completion.
 */
const STREAM_CAP_BYTES = 64 * 1024

let pyodide: PyodideAPI | null = null
let initPromise: Promise<PyodideAPI> | null = null

function post(msg: WorkerResponse): void {
	ctx.postMessage(msg)
}

/**
 * Bring Pyodide up. Only the first caller actually loads; concurrent callers
 * share the in-flight promise. Every caller gets its own `init:ready` so
 * any pending `run` request whose `await init(...)` resolved via the shared
 * promise still produces an observable completion signal for the runner.
 */
async function init(requestId: string, announceReady: boolean): Promise<PyodideAPI> {
	if (!pyodide && !initPromise) {
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
		// Clear the in-flight reference once the promise settles so a future
		// failure doesn't leave callers permanently stuck on a rejected shared
		// promise. On success, `pyodide` is set and `initPromise` is no longer
		// consulted; on failure, the next caller gets a fresh attempt.
		initPromise.finally(() => {
			initPromise = null
		})
	}

	const api = pyodide ?? (await (initPromise as Promise<PyodideAPI>))
	if (announceReady) {
		post({ type: 'init:ready', requestId })
	}
	return api
}

/**
 * Accumulator that tracks a byte budget and appends a truncation marker
 * once the cap is hit. `batched` fires per flushed chunk of printed output,
 * so we short-circuit further appends cheaply once we've already truncated.
 */
class CappedBuffer {
	private parts: string[] = []
	private bytes = 0
	private truncated = false

	append(chunk: string): void {
		if (this.truncated) return
		const piece = `${chunk}\n`
		const remaining = STREAM_CAP_BYTES - this.bytes
		if (piece.length <= remaining) {
			this.parts.push(piece)
			this.bytes += piece.length
			return
		}
		if (remaining > 0) {
			this.parts.push(piece.slice(0, remaining))
			this.bytes += remaining
		}
		this.parts.push(`\n… [output truncated at ${STREAM_CAP_BYTES} bytes]\n`)
		this.truncated = true
	}

	read(): string {
		return this.parts.join('')
	}
}

async function run(
	api: PyodideAPI,
	requestId: string,
	code: string,
	tests: string,
	_entryFunction: string,
): Promise<void> {
	const stdout = new CappedBuffer()
	const stderr = new CappedBuffer()
	api.setStdout({ batched: (s) => stdout.append(s) })
	api.setStderr({ batched: (s) => stderr.append(s) })

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
		stdout: stdout.read(),
		stderr: stderr.read(),
		durationMs,
	})
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	void handle(event.data)
})

async function handle(msg: WorkerRequest): Promise<void> {
	try {
		if (msg.type === 'init') {
			await init(msg.requestId, true)
			return
		}
		if (msg.type === 'run') {
			// The runner sends its own explicit `init` before any `run`, so the
			// load is already done by the time we get here in normal use — but
			// support lazy init here too for callers (tests, future surfaces)
			// that skip the pre-init step.
			const api = await init(msg.requestId, false)
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
