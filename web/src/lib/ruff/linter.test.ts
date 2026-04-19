import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RuffLinter } from './linter'
import { attachRuffToMonaco, diagnosticsToMarkers, MARKER_OWNER } from './monaco'
import type { RuffDiagnostic, WorkerRequest, WorkerResponse } from './protocol'

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

const UNUSED_IMPORT: RuffDiagnostic = {
	code: 'F401',
	message: '`os` imported but unused',
	start_location: { row: 1, column: 8 },
	end_location: { row: 1, column: 10 },
	fix: null,
}

describe('RuffLinter', () => {
	it('init resolves with a version string', async () => {
		const linter = new RuffLinter(
			() =>
				new StubWorker((req) => {
					if (req.type === 'init') {
						return [{ type: 'init:ready', requestId: req.requestId, version: '0.8.4' }]
					}
					return []
				}) as unknown as Worker,
		)

		const { version } = await linter.init()
		expect(version).toBe('0.8.4')
		expect(linter.ruffVersion).toBe('0.8.4')
	})

	it('check returns diagnostics from the worker', async () => {
		const linter = new RuffLinter(
			() =>
				new StubWorker((req) => {
					if (req.type === 'check') {
						return [
							{
								type: 'check:result',
								requestId: req.requestId,
								diagnostics: [UNUSED_IMPORT],
							},
						]
					}
					if (req.type === 'init') {
						return [{ type: 'init:ready', requestId: req.requestId, version: '0.8.4' }]
					}
					return []
				}) as unknown as Worker,
		)

		const diags = await linter.check('import os\n')
		expect(diags).toHaveLength(1)
		expect(diags[0].code).toBe('F401')
	})

	it('format returns the formatted source', async () => {
		const linter = new RuffLinter(
			() =>
				new StubWorker((req) => {
					if (req.type === 'format') {
						return [
							{
								type: 'format:result',
								requestId: req.requestId,
								source: `${req.source.trimEnd()}\n`,
							},
						]
					}
					if (req.type === 'init') {
						return [{ type: 'init:ready', requestId: req.requestId, version: '0.8.4' }]
					}
					return []
				}) as unknown as Worker,
		)

		const out = await linter.format('print(1)   ')
		expect(out).toBe('print(1)\n')
	})

	it('cancel rejects in-flight requests with AbortError', async () => {
		const linter = new RuffLinter(() => new StubWorker((_req) => 'hang') as unknown as Worker)

		const pending = linter.check('x = 1')
		linter.cancel()
		const err = await pending.catch((e) => e)
		expect((err as Error).name).toBe('AbortError')
	})

	it('surfaces worker errors', async () => {
		const linter = new RuffLinter(
			() =>
				new StubWorker((req) => {
					if (req.type === 'check') {
						return [{ type: 'error', requestId: req.requestId, message: 'parse failure' }]
					}
					return []
				}) as unknown as Worker,
		)

		await expect(linter.check('???')).rejects.toThrow(/parse failure/)
	})

	it('dispose terminates the worker and rejects pending requests', async () => {
		let stub!: StubWorker
		const linter = new RuffLinter(() => {
			stub = new StubWorker((_req) => 'hang')
			return stub as unknown as Worker
		})

		const pending = linter.check('x')
		linter.dispose()
		await expect(pending).rejects.toThrow(/cancelled/)
		expect(stub.terminated).toBe(true)
	})
})

describe('diagnosticsToMarkers', () => {
	const monacoStub = {
		MarkerSeverity: { Warning: 4 },
	} as unknown as typeof import('monaco-editor')

	it('maps 1-based row/column through and widens zero-width ranges', () => {
		const markers = diagnosticsToMarkers(monacoStub, [
			UNUSED_IMPORT,
			{
				code: null,
				message: 'zero-width',
				start_location: { row: 3, column: 5 },
				end_location: { row: 3, column: 5 },
				fix: null,
			},
		])

		expect(markers[0]).toMatchObject({
			severity: 4,
			source: MARKER_OWNER,
			message: 'F401: `os` imported but unused',
			startLineNumber: 1,
			startColumn: 8,
			endLineNumber: 1,
			endColumn: 10,
		})
		expect(markers[1]).toMatchObject({
			startLineNumber: 3,
			startColumn: 5,
			endLineNumber: 3,
			endColumn: 6,
			message: 'zero-width',
		})
	})
})

describe('attachRuffToMonaco', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	function makeLinter(opts: { diagnostics?: RuffDiagnostic[]; formatted?: string } = {}) {
		return new RuffLinter(
			() =>
				new StubWorker((req) => {
					if (req.type === 'check') {
						return [
							{
								type: 'check:result',
								requestId: req.requestId,
								diagnostics: opts.diagnostics ?? [],
							},
						]
					}
					if (req.type === 'format') {
						return [
							{
								type: 'format:result',
								requestId: req.requestId,
								source: opts.formatted ?? req.source,
							},
						]
					}
					return []
				}) as unknown as Worker,
		)
	}

	function makeModel(source = '') {
		let content = source
		const listeners: Array<() => void> = []
		const contentSubDispose = vi.fn()
		const model = {
			getValue: () => content,
			setValue(v: string) {
				content = v
				for (const fn of listeners) fn()
			},
			getFullModelRange: () => ({
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 1,
				endColumn: content.length + 1,
			}),
			onDidChangeContent: vi.fn((fn: () => void) => {
				listeners.push(fn)
				return { dispose: contentSubDispose }
			}),
		}
		return { model, contentSubDispose }
	}

	function makeMonaco() {
		const setModelMarkers = vi.fn()
		const monaco = {
			MarkerSeverity: { Warning: 4 },
			KeyMod: { CtrlCmd: 2048 },
			KeyCode: { KeyS: 49 },
			editor: {
				setModelMarkers,
				EditorOption: { readOnly: 83 },
			},
		} as unknown as typeof import('monaco-editor')
		return { monaco, setModelMarkers }
	}

	function makeEditor(model: ReturnType<typeof makeModel>['model']) {
		const executeEdits = vi.fn()
		const actionDispose = vi.fn()
		let capturedRun: ((ed: unknown) => Promise<void>) | null = null
		const editor = {
			getModel: () => model,
			getOption: vi.fn().mockReturnValue(false),
			executeEdits,
			addAction: vi.fn((def: { run: (ed: unknown) => Promise<void> }) => {
				capturedRun = def.run
				return { dispose: actionDispose }
			}),
		}
		return {
			editor: editor as unknown as import('monaco-editor').editor.IStandaloneCodeEditor,
			executeEdits,
			actionDispose,
			runAction: () => capturedRun?.(editor) ?? Promise.resolve(),
		}
	}

	it('runs an initial check and publishes markers', async () => {
		const { model } = makeModel('import os\n')
		const { monaco, setModelMarkers } = makeMonaco()
		const { editor } = makeEditor(model)
		const linter = makeLinter({ diagnostics: [UNUSED_IMPORT] })

		attachRuffToMonaco({ monaco, editor, linter })
		await vi.runAllTimersAsync()

		expect(setModelMarkers).toHaveBeenCalledWith(
			model,
			MARKER_OWNER,
			expect.arrayContaining([
				expect.objectContaining({ message: 'F401: `os` imported but unused' }),
			]),
		)
	})

	it('clears markers and disposes subscriptions on dispose', async () => {
		const { model, contentSubDispose } = makeModel('x = 1')
		const { monaco, setModelMarkers } = makeMonaco()
		const { editor, actionDispose } = makeEditor(model)
		const linter = makeLinter()

		const binding = attachRuffToMonaco({ monaco, editor, linter })
		await vi.runAllTimersAsync()

		binding.dispose()

		expect(setModelMarkers).toHaveBeenLastCalledWith(model, MARKER_OWNER, [])
		expect(contentSubDispose).toHaveBeenCalled()
		expect(actionDispose).toHaveBeenCalled()
	})

	it('format action applies formatted source via executeEdits', async () => {
		const { model } = makeModel('print(1)   ')
		const { monaco } = makeMonaco()
		const { editor, executeEdits, runAction } = makeEditor(model)
		const linter = makeLinter({ formatted: 'print(1)\n' })

		attachRuffToMonaco({ monaco, editor, linter })
		await vi.runAllTimersAsync()

		const p = runAction()
		await vi.runAllTimersAsync()
		await p

		expect(executeEdits).toHaveBeenCalledWith('ruff.format', [
			expect.objectContaining({ text: 'print(1)\n' }),
		])
	})
})
