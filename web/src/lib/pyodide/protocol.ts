/**
 * Message protocol between `runner.ts` (main thread) and `worker.ts` (Pyodide
 * Web Worker). Every request carries a `requestId` that the worker echoes on
 * every response so the runner can correlate multiple in-flight calls — though
 * in practice the runner serializes, one run at a time.
 */

export type WorkerRequest =
	| { type: 'init'; requestId: string }
	| {
			type: 'run'
			requestId: string
			code: string
			tests: string
			entryFunction: string
	  }

export type InitPhase = 'loading-pyodide' | 'loading-pytest' | 'installing-harness'

export type WorkerResponse =
	| {
			type: 'init:progress'
			requestId: string
			phase: InitPhase
			message: string
	  }
	| { type: 'init:ready'; requestId: string }
	| {
			type: 'run:result'
			requestId: string
			summary: PytestSummary
			stdout: string
			stderr: string
			durationMs: number
	  }
	| { type: 'error'; requestId: string; message: string; stack?: string }

export type TestOutcome = 'passed' | 'failed' | 'error' | 'skipped'

export interface TestReport {
	name: string
	outcome: TestOutcome
	durationMs: number
	failureMessage?: string
	stdout?: string
}

export interface PytestSummary {
	passed: number
	failed: number
	errored: number
	skipped: number
	total: number
	tests: TestReport[]
}

/** Thrown by `runner.run()` when the run doesn't finish inside the timeout budget. */
export class TimeoutError extends Error {
	readonly timeoutMs: number
	constructor(timeoutMs: number) {
		super(`Pyodide run timed out after ${timeoutMs}ms`)
		this.name = 'TimeoutError'
		this.timeoutMs = timeoutMs
	}
}
