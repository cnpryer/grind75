<script lang="ts">
import type { editor as MonacoEditorNS } from 'monaco-editor'
import { untrack } from 'svelte'
import { browser } from '$app/environment'
import { theme } from '$lib/utils/theme.svelte'

type Props = {
  value?: string
  language?: string
  readOnly?: boolean
  height?: string
  onChange?: (v: string) => void
  /**
   * Enable Ruff-powered diagnostics + format-on-save (Cmd/Ctrl-S). Off by
   * default so readonly panes (e.g. the Tests tab) don't spin up a linter.
   */
  lint?: boolean
}

let {
  value = $bindable(''),
  language = 'python',
  readOnly = false,
  height = '100%',
  onChange,
  lint = false,
}: Props = $props()

let container: HTMLDivElement | null = null
let instance: MonacoEditorNS.IStandaloneCodeEditor | null = null
let suppressExternalSync = false

$effect(() => {
  if (!browser || !container) return

  let cancelled = false
  let disposers: Array<() => void> = []

  ;(async () => {
    const { createEditor, setGlobalTheme } = await import('$lib/monaco/editor')
    if (cancelled || !container) return
    const monacoTheme = untrack(() => theme.resolved === 'dark' ? 'vs-dark' : 'vs')
    const editor = createEditor(container, { value, language, readOnly, theme: monacoTheme })
    setGlobalTheme(monacoTheme)
    instance = editor
    const sub = editor.onDidChangeModelContent(() => {
      const next = editor.getValue()
      // Write-back into the bindable prop. Flag so our own "sync external
      // value" effect doesn't bounce the value back into setValue().
      suppressExternalSync = true
      value = next
      onChange?.(next)
      queueMicrotask(() => {
        suppressExternalSync = false
      })
    })
    disposers.push(() => sub.dispose())
    disposers.push(() => editor.dispose())

    if (lint && language === 'python' && !readOnly) {
      try {
        const [{ RuffLinter }, { attachRuffToMonaco }, monacoNs] = await Promise.all([
          import('$lib/ruff/linter'),
          import('$lib/ruff/monaco'),
          import('monaco-editor'),
        ])
        if (cancelled) return
        const linter = new RuffLinter()
        const binding = attachRuffToMonaco({
          monaco: monacoNs,
          editor,
          linter,
        })
        disposers.push(() => binding.dispose())
        disposers.push(() => linter.dispose())
      } catch (err) {
        console.warn('ruff: failed to attach linter', err)
      }
    }
  })()

  return () => {
    cancelled = true
    for (const fn of disposers) fn()
    instance = null
  }
})

// Keep the editor's text in sync when the `value` prop is changed externally
// (e.g. "Reset to starter"). Skip on write-backs from our own onDidChange
// handler to avoid clobbering cursor position.
$effect(() => {
  const current = value
  if (!instance || suppressExternalSync) return
  if (instance.getValue() !== current) {
    instance.setValue(current)
  }
})

$effect(() => {
  instance?.updateOptions({ readOnly })
})

// Update Monaco theme without recreating the editor when the site theme changes.
$effect(() => {
  const monacoTheme = theme.resolved === 'dark' ? 'vs-dark' : 'vs'
  if (!instance) return
  import('$lib/monaco/editor').then(({ setGlobalTheme }) => setGlobalTheme(monacoTheme))
})
</script>

<div bind:this={container} class="monaco-container" style:height></div>

<style>
  .monaco-container {
    width: 100%;
    min-height: 200px;
  }
</style>
