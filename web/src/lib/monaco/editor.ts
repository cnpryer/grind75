/**
 * Monaco singleton setup. Only imported dynamically from `MonacoEditor.svelte`
 * under a `{#if browser}` guard — never evaluated on the server.
 *
 * The `?worker` import is the Vite-blessed way to hand Monaco a `Worker`
 * constructor without shipping `worker-src` via a CDN. We only register the
 * base editor worker; Python syntax highlighting is purely lexical and needs
 * nothing else.
 */

import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'

let configured = false

function configureOnce(): void {
	if (configured) return
	configured = true
	// Monaco reads `self.MonacoEnvironment` to learn how to spawn its workers.
	// The library types `getWorker` as returning `Worker | Promise<Worker>` with
	// extra `workerId`/`label` params we don't use; our narrower impl is fine at
	// runtime but needs a widening cast for the types to line up.
	self.MonacoEnvironment = {
		getWorker: () => new EditorWorker(),
	} as monaco.Environment
}

export interface CreateEditorOptions {
	value: string
	language?: string
	readOnly?: boolean
	theme?: 'vs' | 'vs-dark'
}

export function createEditor(
	container: HTMLElement,
	opts: CreateEditorOptions,
): monaco.editor.IStandaloneCodeEditor {
	configureOnce()
	return monaco.editor.create(container, {
		value: opts.value,
		language: opts.language ?? 'python',
		theme: opts.theme ?? 'vs-dark',
		readOnly: opts.readOnly ?? false,
		automaticLayout: true,
		fontSize: 14,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		tabSize: 4,
		insertSpaces: true,
		renderLineHighlight: 'line',
	})
}

export function setGlobalTheme(theme: 'vs' | 'vs-dark'): void {
	configureOnce()
	monaco.editor.setTheme(theme)
}

export type { monaco }
