/**
 * Message protocol between `linter.ts` (main thread) and `worker.ts` (the
 * Ruff WASM worker). Keeps the same `requestId` correlation pattern used by
 * the Pyodide runner so the two integrations stay analogous.
 */

export type WorkerRequest =
	| { type: 'init'; requestId: string }
	| { type: 'check'; requestId: string; source: string }
	| { type: 'format'; requestId: string; source: string }

export type WorkerResponse =
	| { type: 'init:ready'; requestId: string; version: string }
	| { type: 'check:result'; requestId: string; diagnostics: RuffDiagnostic[] }
	| { type: 'format:result'; requestId: string; source: string }
	| { type: 'error'; requestId: string; message: string; stack?: string }

export interface RuffPosition {
	/** 1-based line number. */
	row: number
	/** 1-based column, UTF-16 code units (matches Monaco). */
	column: number
}

export interface RuffEdit {
	content: string | null
	location: RuffPosition
	end_location: RuffPosition
}

export interface RuffFix {
	message: string | null
	edits: RuffEdit[]
}

export interface RuffDiagnostic {
	code: string | null
	message: string
	start_location: RuffPosition
	end_location: RuffPosition
	fix: RuffFix | null
}
