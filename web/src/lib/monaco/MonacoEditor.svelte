<script lang="ts">
import type { editor as MonacoEditorNS } from 'monaco-editor'
import { browser } from '$app/environment'

type Props = {
  value?: string
  language?: string
  readOnly?: boolean
  height?: string
  onChange?: (v: string) => void
}

let {
  value = $bindable(''),
  language = 'python',
  readOnly = false,
  height = '100%',
  onChange,
}: Props = $props()

let container: HTMLDivElement | null = null
let instance: MonacoEditorNS.IStandaloneCodeEditor | null = null
let suppressExternalSync = false

$effect(() => {
  if (!browser || !container) return

  let cancelled = false
  let disposers: Array<() => void> = []

  ;(async () => {
    const { createEditor } = await import('$lib/monaco/editor')
    if (cancelled || !container) return
    const editor = createEditor(container, { value, language, readOnly })
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
</script>

<div bind:this={container} class="monaco-container" style:height></div>

<style>
  .monaco-container {
    width: 100%;
    min-height: 200px;
  }
</style>
