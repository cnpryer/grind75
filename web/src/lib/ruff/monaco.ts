/**
 * Glue between `RuffLinter` and a Monaco editor instance.
 *
 * Responsibilities (pulled out of the Svelte component so it can be unit-
 * tested without mounting Monaco):
 *   - Map a `RuffDiagnostic[]` to `monaco.editor.IMarkerData[]`.
 *   - Debounce `check()` on model content changes and publish markers under a
 *     fixed `owner` string.
 *   - Wire a `Cmd/Ctrl-S` keybinding that runs `format()` and applies the
 *     result via `executeEdits` so Monaco keeps one undo step.
 */

import type { IDisposable, editor as MonacoEditorNS } from 'monaco-editor'
import type { RuffDiagnostic, RuffLinter } from './linter'

/** Where Monaco stores our markers — distinct from any other provider. */
export const MARKER_OWNER = 'ruff'

type MonacoModule = typeof import('monaco-editor')

export function diagnosticsToMarkers(
	monaco: MonacoModule,
	diagnostics: RuffDiagnostic[],
): MonacoEditorNS.IMarkerData[] {
	return diagnostics.map((d) => {
		// Ruff ExpandedMessage delivers 1-based `row`/`column`. Monaco also uses
		// 1-based lines and columns, so they map directly. `end_column` may
		// equal `start_column` for zero-width diagnostics; Monaco requires
		// `endColumn > startColumn` to draw an underline, so we widen by 1 in
		// that case.
		const startLineNumber = d.start_location.row
		const startColumn = d.start_location.column
		const endLineNumber = d.end_location.row
		let endColumn = d.end_location.column
		if (endLineNumber === startLineNumber && endColumn <= startColumn) {
			endColumn = startColumn + 1
		}
		return {
			severity: monaco.MarkerSeverity.Warning,
			message: d.code ? `${d.code}: ${d.message}` : d.message,
			source: MARKER_OWNER,
			code: d.code ?? undefined,
			startLineNumber,
			startColumn,
			endLineNumber,
			endColumn,
		}
	})
}

export interface AttachOptions {
	monaco: MonacoModule
	editor: MonacoEditorNS.IStandaloneCodeEditor
	linter: RuffLinter
	/** Debounce for `check` triggered by content changes. Default 300ms. */
	debounceMs?: number
	/** Called when `check()` rejects (e.g. init failure). Default: console.warn. */
	onError?: (err: unknown) => void
}

export interface RuffMonacoBinding extends IDisposable {
	/** Force a re-check (bypassing debounce). Useful after `setValue`. */
	refresh(): void
}

/**
 * Attach the linter to an editor. Returns a disposable that detaches listeners
 * and clears any pending debounce timer. Markers are cleared on dispose so a
 * reused model doesn't keep stale squigglies.
 */
export function attachRuffToMonaco(opts: AttachOptions): RuffMonacoBinding {
	const { monaco, editor, linter, debounceMs = 300, onError } = opts
	const maybeModel = editor.getModel()
	if (!maybeModel) throw new Error('attachRuffToMonaco: editor has no model')
	// Capture under a narrowed name — TS doesn't preserve control-flow narrowing
	// across the async closures below.
	const model: MonacoEditorNS.ITextModel = maybeModel

	const reportError = onError ?? ((err) => console.warn('ruff:', err))

	let debounce: ReturnType<typeof setTimeout> | null = null
	let checkSeq = 0
	let disposed = false

	async function runCheck(): Promise<void> {
		const seq = ++checkSeq
		const source = model.getValue()
		try {
			const diagnostics = await linter.check(source)
			if (disposed) return
			// Stale — a newer check was scheduled before this one resolved.
			if (seq !== checkSeq) return
			const markers = diagnosticsToMarkers(monaco, diagnostics)
			monaco.editor.setModelMarkers(model, MARKER_OWNER, markers)
		} catch (err) {
			if (disposed) return
			if ((err as Error)?.name === 'AbortError') return
			reportError(err)
		}
	}

	function scheduleCheck(): void {
		if (debounce) clearTimeout(debounce)
		debounce = setTimeout(() => {
			debounce = null
			void runCheck()
		}, debounceMs)
	}

	const contentSub = model.onDidChangeContent(() => scheduleCheck())

	// First pass: check what's already in the editor without waiting for a
	// keystroke. Fire-and-forget; errors route through `onError`.
	void runCheck()

	// Format-on-save: Cmd+S on macOS, Ctrl+S elsewhere. `editor.addAction` is
	// the blessed way to add both a keybinding and a command-palette entry.
	const action = editor.addAction({
		id: 'ruff.format',
		label: 'Format with Ruff',
		keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
		contextMenuGroupId: '1_modification',
		contextMenuOrder: 1.5,
		run: async (ed) => {
			if (ed.getOption(monaco.editor.EditorOption.readOnly)) return
			const current = model.getValue()
			try {
				const formatted = await linter.format(current)
				if (disposed || formatted === current) return
				const fullRange = model.getFullModelRange()
				ed.executeEdits('ruff.format', [
					{ range: fullRange, text: formatted, forceMoveMarkers: true },
				])
				// Kick a fresh check against the formatted source.
				scheduleCheck()
			} catch (err) {
				if ((err as Error)?.name === 'AbortError') return
				reportError(err)
			}
		},
	})

	return {
		refresh: scheduleCheck,
		dispose: () => {
			disposed = true
			if (debounce) clearTimeout(debounce)
			contentSub.dispose()
			action.dispose()
			monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
		},
	}
}
