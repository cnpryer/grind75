<script lang="ts">
import { onDestroy, untrack } from 'svelte'
import { beforeNavigate } from '$app/navigation'
import type { ProgressRecord, ProgressStatus } from '$lib/api/client'
import MonacoEditor from '$lib/monaco/MonacoEditor.svelte'
import { TimeoutError } from '$lib/pyodide/protocol'
import { type InitProgress, PyodideRunner, type RunResult } from '$lib/pyodide/runner'
import { renderMarkdown } from '$lib/utils/markdown'

let { data } = $props()

const meta = $derived(data.problem.meta)
const markdown = $derived(data.problem.markdown)
const starter = $derived(data.problem.starter)
const tests = $derived(data.problem.tests)
const timeoutMs = $derived(meta.execution_timeout_seconds * 1000)

let code = $state('')
let notes = $state('')
let activeTab = $state<'code' | 'tests' | 'output'>('code')
let progressStatus = $state<ProgressStatus>('not_started')
let attemptCount = $state<number>(0)
let lastSavedCode = $state('')
let lastSavedNotes = $state('')

// When the user navigates to a different slug, SvelteKit reuses this component
// and updates `data` in place. Snap the editor back to the new starter.
let lastSlug = untrack(() => data.problem.meta.slug)
function hydrateFromData() {
  const progress = data.progress
  code = progress?.last_code ?? data.problem.starter
  notes = progress?.notes ?? ''
  progressStatus = progress?.status ?? 'not_started'
  attemptCount = progress?.attempt_count ?? 0
  lastSavedCode = code
  lastSavedNotes = notes
}

// Initialize synchronously so the editor sees the correct value on first render.
hydrateFromData()

$effect(() => {
  if (meta.slug !== lastSlug) {
    lastSlug = meta.slug
    hydrateFromData()
    runState = { kind: 'idle' }
  }
})

let renderedMarkdown = $state('')
$effect(() => {
  renderMarkdown(markdown).then((html) => {
    renderedMarkdown = html
  })
})

type RunState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'running' }
  | { kind: 'done'; result: RunResult; codeSnapshot: string }
  | { kind: 'error'; message: string; timedOut: boolean }

let runState = $state<RunState>({ kind: 'idle' })
let submitState = $state<'idle' | 'submitting' | 'error'>('idle')
let submitError = $state<string | null>(null)
let codeSaveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
let codeSaveError = $state<string | null>(null)
let notesState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
let notesError = $state<string | null>(null)
let notesSaveTimer: ReturnType<typeof setTimeout> | null = null

let runner: PyodideRunner | null = null
function getRunner(): PyodideRunner {
  if (!runner) {
    runner = new PyodideRunner()
    runner.setInitProgressHandler((p: InitProgress) => {
      if (runState.kind === 'loading') {
        runState = { kind: 'loading', message: p.message }
      }
    })
  }
  return runner
}

onDestroy(() => {
  runner?.dispose()
  runner = null
  if (notesSaveTimer) {
    clearTimeout(notesSaveTimer)
    notesSaveTimer = null
  }
})

async function executeRun(): Promise<RunResult> {
  const r = getRunner()
  runState = r.isReady ? { kind: 'running' } : { kind: 'loading', message: 'Loading Python…' }
  const result = await r.run({
    code,
    tests,
    entryFunction: meta.entry_function,
    timeoutMs,
  })
  runState = { kind: 'done', result, codeSnapshot: code }
  activeTab = 'output'
  return result
}

async function runTests() {
  try {
    await executeRun()
  } catch (err) {
    const timedOut = err instanceof TimeoutError
    const message = err instanceof Error ? err.message : String(err)
    runState = { kind: 'error', message, timedOut }
    activeTab = 'output'
  }
}

function resetToStarter() {
  code = starter
}

const hasUnsavedCode = $derived(code !== lastSavedCode)
const hasUnsavedNotes = $derived(notes !== lastSavedNotes)

beforeNavigate((navigation) => {
  if (!hasUnsavedCode && !hasUnsavedNotes && notesState !== 'saving') {
    return
  }

  const ok = window.confirm('You have unsaved changes. Leave without saving?')
  if (!ok) {
    navigation.cancel()
  }
})

async function loadProgress() {
  const response = await fetch(`/api/progress/${encodeURIComponent(meta.slug)}`)
  if (!response.ok) {
    return
  }

  const progress: ProgressRecord = await response.json()
  progressStatus = progress.status
  attemptCount = progress.attempt_count
  code = progress.last_code ?? starter
  notes = progress.notes ?? ''
  lastSavedCode = code
  lastSavedNotes = notes
}

async function saveCode() {
  codeSaveState = 'saving'
  codeSaveError = null
  try {
    const response = await fetch(`/api/progress/${encodeURIComponent(meta.slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_code: code }),
    })
    if (!response.ok) {
      throw new Error('Unable to save code')
    }

    const progress: ProgressRecord = await response.json()
    progressStatus = progress.status
    attemptCount = progress.attempt_count
    lastSavedCode = progress.last_code ?? code
    codeSaveState = 'saved'
  } catch (err) {
    codeSaveState = 'error'
    codeSaveError = err instanceof Error ? err.message : 'Unable to save code'
  }
}

async function saveNotes(nextNotes: string) {
  notesState = 'saving'
  notesError = null
  try {
    const response = await fetch(`/api/progress/${encodeURIComponent(meta.slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: nextNotes }),
    })
    if (!response.ok) {
      throw new Error('Unable to save notes')
    }
    const progress: ProgressRecord = await response.json()
    progressStatus = progress.status
    attemptCount = progress.attempt_count
    lastSavedNotes = progress.notes ?? ''
    notesState = 'saved'
  } catch (err) {
    notesState = 'error'
    notesError = err instanceof Error ? err.message : 'Unable to save notes'
  }
}

$effect(() => {
  const currentNotes = notes
  if (currentNotes === lastSavedNotes) {
    if (notesSaveTimer) {
      clearTimeout(notesSaveTimer)
      notesSaveTimer = null
    }
    notesState = 'idle'
    return
  }

  notesState = 'saving'
  if (notesSaveTimer) {
    clearTimeout(notesSaveTimer)
  }
  notesSaveTimer = setTimeout(() => {
    void saveNotes(currentNotes)
  }, 500)
})

async function submitAttempt() {
  submitState = 'submitting'
  submitError = null

  try {
    const result =
      runState.kind === 'done' && runState.codeSnapshot === code
        ? runState.result
        : await executeRun()
    const summary = result.summary

    const response = await fetch('/api/attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: meta.slug,
        code,
        passed: summary.failed === 0 && summary.errored === 0,
        duration_ms: result.durationMs,
        pytest_summary: summary,
      }),
    })
    if (!response.ok) {
      throw new Error('Unable to save submission')
    }

    await loadProgress()
    submitState = 'idle'
    codeSaveState = 'saved'
  } catch (err) {
    submitState = 'error'
    submitError = err instanceof Error ? err.message : 'Unable to submit'
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/login'
}
</script>

<svelte:head>
  <title>{meta.title} — grind75</title>
</svelte:head>

<div class="flex h-screen flex-col">
  <header class="flex items-center justify-between border-b border-gray-200 px-6 py-3">
    <div class="flex items-center gap-4">
      <a href="/" class="text-sm text-gray-500 hover:text-black">← grind75</a>
      <h1 class="text-lg font-semibold">{meta.title}</h1>
      <span class="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-600">
        {meta.difficulty}
      </span>
      <span class="text-xs text-gray-500">{meta.pattern}</span>
    </div>
    <div class="flex items-center gap-3 text-sm text-gray-600">
      <span
        class="rounded px-2 py-0.5 text-xs"
        class:bg-gray-100={progressStatus === 'not_started'}
        class:text-gray-600={progressStatus === 'not_started'}
        class:bg-amber-100={progressStatus === 'attempted'}
        class:text-amber-700={progressStatus === 'attempted'}
        class:bg-green-100={progressStatus === 'solved'}
        class:text-green-700={progressStatus === 'solved'}
      >
        {progressStatus.replace('_', ' ')}
      </span>
      <span>{attemptCount} attempt{attemptCount === 1 ? '' : 's'}</span>
      <span>{data.user?.username}</span>
      <button type="button" class="text-gray-500 hover:text-black" onclick={logout}>
        Sign out
      </button>
    </div>
  </header>

  <div class="grid flex-1 min-h-0 grid-cols-2 gap-0">
    <section class="overflow-auto border-r border-gray-200 p-6">
      <article class="prose prose-sm max-w-none">
        {@html renderedMarkdown}
      </article>
      <div class="mt-6 border-t border-gray-200 pt-4">
        <label for="notes" class="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
          Notes
        </label>
        <textarea
          id="notes"
          class="h-48 w-full rounded border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
          bind:value={notes}
          placeholder="Write down observations, edge cases, and retry plan…"
        ></textarea>
        <div class="mt-2 text-xs text-gray-500">
          {#if notesState === 'saving'}
            Saving…
          {:else if notesState === 'saved'}
            Saved
          {:else if notesState === 'error'}
            {notesError}
          {/if}
        </div>
      </div>
    </section>

    <section class="flex min-h-0 flex-col">
      <div class="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <div class="flex gap-1 text-sm">
          <button
            type="button"
            class="rounded px-3 py-1"
            class:bg-gray-900={activeTab === 'code'}
            class:text-white={activeTab === 'code'}
            class:text-gray-600={activeTab !== 'code'}
            onclick={() => (activeTab = 'code')}
          >
            Code
          </button>
          <button
            type="button"
            class="rounded px-3 py-1"
            class:bg-gray-900={activeTab === 'tests'}
            class:text-white={activeTab === 'tests'}
            class:text-gray-600={activeTab !== 'tests'}
            onclick={() => (activeTab = 'tests')}
          >
            Tests
          </button>
          <button
            type="button"
            class="rounded px-3 py-1"
            class:bg-gray-900={activeTab === 'output'}
            class:text-white={activeTab === 'output'}
            class:text-gray-600={activeTab !== 'output'}
            onclick={() => (activeTab = 'output')}
          >
            Output
          </button>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            onclick={saveCode}
            disabled={!hasUnsavedCode || runState.kind === 'running' || runState.kind === 'loading' || submitState === 'submitting' || codeSaveState === 'saving'}
          >
            {codeSaveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
            onclick={resetToStarter}
            disabled={runState.kind === 'running' || runState.kind === 'loading'}
          >
            Reset to starter
          </button>
          <button
            type="button"
            class="rounded bg-black px-3 py-1 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            onclick={runTests}
            disabled={runState.kind === 'running' || runState.kind === 'loading' || submitState === 'submitting'}
          >
            {runState.kind === 'running'
              ? 'Running…'
              : runState.kind === 'loading'
                ? 'Loading…'
                : 'Run'}
          </button>
          <button
            type="button"
            class="rounded bg-green-700 px-3 py-1 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-60"
            onclick={submitAttempt}
            disabled={runState.kind === 'running' || runState.kind === 'loading' || submitState === 'submitting'}
          >
            {submitState === 'submitting' ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
      <div class="border-b border-gray-200 px-4 py-1 text-xs text-gray-500">
        <span class="font-mono">Expected function: {meta.entry_function}</span>
        {#if hasUnsavedCode}
          <span class="ml-3 text-amber-700">Unsaved code changes</span>
        {:else if codeSaveState === 'saved'}
          <span class="ml-3 text-green-700">Code saved</span>
        {:else if codeSaveState === 'error'}
          <span class="ml-3 text-red-700">{codeSaveError}</span>
        {/if}
      </div>

      <div class="min-h-0 flex-1" class:hidden={activeTab !== 'code'}>
        <MonacoEditor bind:value={code} language="python" height="100%" lint={true} />
      </div>

      <div class="min-h-0 flex-1" class:hidden={activeTab !== 'tests'}>
        <MonacoEditor value={tests} language="python" readOnly={true} height="100%" />
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4" class:hidden={activeTab !== 'output'}>
        {#if runState.kind === 'idle'}
          <p class="text-sm text-gray-500">Click Run to execute the tests.</p>
        {:else if runState.kind === 'loading'}
          <p class="text-sm text-gray-600">{runState.message}</p>
        {:else if runState.kind === 'running'}
          <p class="text-sm text-gray-600">Running tests…</p>
        {:else if runState.kind === 'error'}
          {#if runState.timedOut}
            <p class="text-sm font-medium text-red-700">
              Timed out after {timeoutMs / 1000}s — the worker was terminated. The next run
              will spin up a fresh interpreter.
            </p>
          {:else}
            <p class="text-sm font-medium text-red-700">Error: {runState.message}</p>
          {/if}
        {:else if runState.kind === 'done'}
          {@const { summary, stdout, stderr, durationMs } = runState.result}
          <div class="space-y-3 text-sm">
            <div class="flex items-center gap-4">
              <span class="font-medium">
                {summary.passed}/{summary.total} passed
              </span>
              {#if summary.failed > 0}
                <span class="text-red-600">{summary.failed} failed</span>
              {/if}
              {#if summary.errored > 0}
                <span class="text-red-600">{summary.errored} errored</span>
              {/if}
              {#if summary.skipped > 0}
                <span class="text-gray-500">{summary.skipped} skipped</span>
              {/if}
              <span class="text-gray-500">{durationMs}ms</span>
            </div>
            <ul class="space-y-2">
              {#each summary.tests as t (t.name)}
                <li class="rounded border border-gray-200 p-2">
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-block h-2 w-2 rounded-full"
                      class:bg-green-500={t.outcome === 'passed'}
                      class:bg-red-500={t.outcome === 'failed' || t.outcome === 'error'}
                      class:bg-gray-400={t.outcome === 'skipped'}
                    ></span>
                    <span class="font-mono text-xs">{t.name}</span>
                    <span class="ml-auto text-xs text-gray-500">{t.durationMs}ms</span>
                  </div>
                  {#if t.failureMessage}
                    <pre class="mt-2 overflow-auto rounded bg-gray-50 p-2 text-xs text-red-700">{t.failureMessage}</pre>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if stdout}
              <details>
                <summary class="cursor-pointer text-xs text-gray-500">stdout</summary>
                <pre class="mt-1 overflow-auto rounded bg-gray-50 p-2 text-xs">{stdout}</pre>
              </details>
            {/if}
            {#if stderr}
              <details>
                <summary class="cursor-pointer text-xs text-gray-500">stderr</summary>
                <pre class="mt-1 overflow-auto rounded bg-gray-50 p-2 text-xs">{stderr}</pre>
              </details>
            {/if}
          </div>
        {/if}
        {#if submitState === 'error' && submitError}
          <p class="mt-4 text-sm font-medium text-red-700">Submit error: {submitError}</p>
        {/if}
      </div>
    </section>
  </div>
</div>
