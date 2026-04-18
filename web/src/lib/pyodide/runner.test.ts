import { afterEach, describe, expect, it, vi } from 'vitest'

import { TimeoutError, type WorkerRequest, type WorkerResponse } from './protocol'
import { PyodideRunner } from './runner'

/**
 * A scriptable stub worker. Each run() call registers a programmable response
 * for the next 'run' request, so tests can simulate both real pytest summaries
 * and wedged workers that never reply (to exercise the timeout path).
 */
class StubWorker {
	listeners: {
		message: Array<(e: MessageEvent<WorkerResponse>) => void>
		error: Array<(e: ErrorEvent) => void>
	} = { message: [], error: [] }
	terminated = false
	handler: (req: WorkerRequest) => WorkerResponse[] | 'hang'

	constructor(handler: (req: WorkerRequest) => WorkerResponse[] | 'hang') {
		this.handler = handler
	}

	addEventListener<K extends 'message' | 'error'>(
		type: K,
		fn: K extends 'message' ? (e: MessageEvent<WorkerResponse>) => void : (e: ErrorEvent) => void,
	): void {
		// biome-ignore lint/suspicious/noExplicitAny: union-dispatch simpler as any here
		;(this.listeners[type] as any).push(fn)
	}

	postMessage(req: WorkerRequest): void {
		if (this.terminated) return
		const result = this.handler(req)
		if (result === 'hang') return
		// Deliver async, matching real postMessage semantics. setTimeout(0) so
		// vi.useFakeTimers + advanceTimersByTimeAsync can pump delivery
		// deterministically from tests that need it.
		setTimeout(() => {
			for (const resp of result) {
				for (const fn of this.listeners.message) fn({ data: resp } as MessageEvent<WorkerResponse>)
			}
		}, 0)
	}

	terminate(): void {
		this.terminated = true
	}
}

function readySummary(requestId: string): WorkerResponse {
	return {
		type: 'run:result',
		requestId,
		summary: {
			passed: 3,
			failed: 0,
			errored: 0,
			skipped: 0,
			total: 3,
			tests: [
				{ name: 'test_basic', outcome: 'passed', durationMs: 1 },
				{ name: 'test_dupes', outcome: 'passed', durationMs: 1 },
				{ name: 'test_negatives', outcome: 'passed', durationMs: 2 },
			],
		},
		stdout: '',
		stderr: '',
		durationMs: 4,
	}
}

function initSequence(requestId: string): WorkerResponse[] {
	return [
		{ type: 'init:progress', requestId, phase: 'loading-pyodide', message: 'Loading…' },
		{ type: 'init:progress', requestId, phase: 'loading-pytest', message: 'Loading pytest…' },
		{ type: 'init:ready', requestId },
	]
}

describe('PyodideRunner', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('runs init then returns a structured PytestSummary', async () => {
		const stubs: StubWorker[] = []
		const runner = new PyodideRunner(() => {
			const w = new StubWorker((req) => {
				if (req.type === 'init') return initSequence(req.requestId)
				if (req.type === 'run') return [readySummary(req.requestId)]
				return []
			})
			stubs.push(w)
			return w as unknown as Worker
		})

		const progress: string[] = []
		runner.setInitProgressHandler((p) => progress.push(p.phase))

		const result = await runner.run({
			code: 'def two_sum(nums, target): return [0, 1]',
			tests: 'def test_basic(): assert True',
			entryFunction: 'two_sum',
			timeoutMs: 1000,
		})

		expect(result.summary.total).toBe(3)
		expect(result.summary.passed).toBe(3)
		expect(result.summary.tests[0].outcome).toBe('passed')
		expect(progress).toEqual(['loading-pyodide', 'loading-pytest'])
		expect(runner.isReady).toBe(true)
		expect(stubs).toHaveLength(1)
	})

	it('times out on a wedged worker and respawns for the next run', async () => {
		vi.useFakeTimers()

		const stubs: StubWorker[] = []
		let callCount = 0
		const runner = new PyodideRunner(() => {
			callCount++
			const thisCall = callCount
			const w = new StubWorker((req) => {
				if (req.type === 'init') return initSequence(req.requestId)
				if (req.type === 'run') {
					// First spawned worker hangs on run; second returns success.
					if (thisCall === 1) return 'hang'
					return [readySummary(req.requestId)]
				}
				return []
			})
			stubs.push(w)
			return w as unknown as Worker
		})

		const hanging = runner.run({
			code: 'while True: pass',
			tests: 'def test_basic(): assert True',
			entryFunction: 'two_sum',
			timeoutMs: 100,
		})
		// Attach a catch handler synchronously so the timeout rejection is
		// never unhandled, even briefly.
		const hangingCaught = hanging.catch((e) => e)

		// Let init messages flush.
		await vi.advanceTimersByTimeAsync(0)

		// Advance past the run timeout.
		await vi.advanceTimersByTimeAsync(150)
		const err = await hangingCaught
		expect(err).toBeInstanceOf(TimeoutError)

		expect(stubs[0].terminated).toBe(true)
		expect(runner.isReady).toBe(false)

		// Next run must respawn the worker and complete cleanly.
		const next = runner.run({
			code: 'def two_sum(nums, target): return [0, 1]',
			tests: 'def test_basic(): assert True',
			entryFunction: 'two_sum',
			timeoutMs: 1000,
		})
		// Drain all remaining timers so the init → run cascade resolves.
		await vi.runAllTimersAsync()
		const result = await next

		expect(stubs).toHaveLength(2)
		expect(stubs[1].terminated).toBe(false)
		expect(result.summary.passed).toBe(3)
		expect(runner.isReady).toBe(true)
	})

	it('surfaces worker errors as rejections', async () => {
		const runner = new PyodideRunner(() => {
			return new StubWorker((req) => {
				if (req.type === 'init') return initSequence(req.requestId)
				if (req.type === 'run') {
					return [
						{
							type: 'error',
							requestId: req.requestId,
							message: 'ModuleNotFoundError: no module named solution',
						},
					]
				}
				return []
			}) as unknown as Worker
		})

		await expect(
			runner.run({
				code: '',
				tests: '',
				entryFunction: 'x',
				timeoutMs: 1000,
			}),
		).rejects.toThrow(/ModuleNotFoundError/)
	})

	it('dispose tears down the worker and rejects pending calls', async () => {
		let stub!: StubWorker
		const runner = new PyodideRunner(() => {
			stub = new StubWorker((req) => {
				if (req.type === 'init') return initSequence(req.requestId)
				return 'hang'
			})
			return stub as unknown as Worker
		})

		const pending = runner.run({
			code: 'x',
			tests: 'y',
			entryFunction: 'z',
			timeoutMs: 10_000,
		})
		// Yield the event loop so init messages are delivered (real setTimeout).
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		runner.dispose()
		await expect(pending).rejects.toThrow(/disposed/)
		expect(stub.terminated).toBe(true)
		expect(runner.isReady).toBe(false)
	})
})
