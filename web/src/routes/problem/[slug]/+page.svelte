<script lang="ts">
import { onDestroy, onMount, untrack } from 'svelte'
import { beforeNavigate } from '$app/navigation'
import type { ProgressRecord, ProgressStatus } from '$lib/api/client'
import MonacoEditor from '$lib/monaco/MonacoEditor.svelte'
import { TimeoutError } from '$lib/pyodide/protocol'
import { type InitProgress, PyodideRunner, type RunResult } from '$lib/pyodide/runner'
import { renderMarkdown } from '$lib/utils/markdown'
import { formatElapsed, Timer } from '$lib/utils/timer.svelte'

let { data } = $props()

const meta = $derived(data.problem.meta)
const markdown = $derived(data.problem.markdown)
const starter = $derived(data.problem.starter)
const tests = $derived(data.problem.tests)
const timeoutMs = $derived(meta.execution_timeout_seconds * 1000)

let code = $state('')
let notes = $state('')
// 'problem' is only surfaced on narrow viewports where the markdown + notes
// pane stacks behind the editor in the tab bar. On md+ both panels are
// visible side-by-side and 'problem' is never the active tab.
let activeTab = $state<'problem' | 'code' | 'tests' | 'output'>('code')
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

// Respect the user-controlled setting set via /settings. Read reactively so
// a settings change followed by invalidateAll() propagates without a reload.
const autoStartTimer = $derived(data.settings?.auto_start_timer ?? false)

// Initial open: auto-start on client mount so we don't tick during SSR.
onMount(() => {
  if (untrack(() => autoStartTimer)) {
    timer.start()
  }
})

$effect(() => {
  if (meta.slug !== lastSlug) {
    lastSlug = meta.slug
    hydrateFromData()
    runState = { kind: 'idle' }
    timer.reset()
    if (untrack(() => autoStartTimer)) {
      timer.start()
    }
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

const timer = new Timer()

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
  timer.dispose()
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
  timer.stop()
  const elapsedMs = Math.round(timer.elapsedMs)

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
        duration_ms: Math.round(result.durationMs),
        elapsed_ms: elapsedMs,
        pytest_summary: summary,
      }),
    })
    if (!response.ok) {
      throw new Error('Unable to save submission')
    }

    await loadProgress()
    submitState = 'idle'
    codeSaveState = 'saved'
    timer.reset()
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
  <header class="flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-200 px-4 py-3 md:px-6 dark:border-gray-800">
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <a href="/" class="text-sm text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white">← grind75</a>
      <h1 class="truncate text-base font-semibold md:text-lg">{meta.title}</h1>
      <span class="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        {meta.difficulty}
      </span>
      <span class="text-xs text-gray-500 dark:text-gray-400">{meta.pattern}</span>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-sm text-gray-600 md:gap-3 dark:text-gray-300">
      <span
        class="rounded px-2 py-0.5 text-xs"
        class:bg-gray-100={progressStatus === 'not_started'}
        class:text-gray-600={progressStatus === 'not_started'}
        class:dark:bg-gray-800={progressStatus === 'not_started'}
        class:dark:text-gray-300={progressStatus === 'not_started'}
        class:bg-amber-100={progressStatus === 'attempted'}
        class:text-amber-700={progressStatus === 'attempted'}
        class:dark:bg-amber-950={progressStatus === 'attempted'}
        class:dark:text-amber-300={progressStatus === 'attempted'}
        class:bg-green-100={progressStatus === 'solved'}
        class:text-green-700={progressStatus === 'solved'}
        class:dark:bg-green-950={progressStatus === 'solved'}
        class:dark:text-green-300={progressStatus === 'solved'}
      >
        {progressStatus.replace('_', ' ')}
      </span>
      <span class="hidden sm:inline">{attemptCount} attempt{attemptCount === 1 ? '' : 's'}</span>
      <span class="hidden md:inline">{data.user?.username}</span>
      <a href="/settings" class="text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white">Settings</a>
      <button type="button" class="text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white" onclick={logout}>
        Sign out
      </button>
    </div>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-200 px-3 py-2 md:px-4 dark:border-gray-800">
    <div class="flex gap-1 text-sm">
      <button
        type="button"
        class="rounded px-3 py-1 lg:hidden"
        class:bg-gray-900={activeTab === 'problem'}
        class:text-white={activeTab === 'problem'}
        class:dark:bg-gray-100={activeTab === 'problem'}
        class:dark:text-gray-900={activeTab === 'problem'}
        class:text-gray-600={activeTab !== 'problem'}
        class:dark:text-gray-300={activeTab !== 'problem'}
        onclick={() => (activeTab = 'problem')}
      >
        Problem
      </button>
      <button
        type="button"
        class="rounded px-3 py-1"
        class:bg-gray-900={activeTab === 'code'}
        class:text-white={activeTab === 'code'}
        class:dark:bg-gray-100={activeTab === 'code'}
        class:dark:text-gray-900={activeTab === 'code'}
        class:text-gray-600={activeTab !== 'code'}
        class:dark:text-gray-300={activeTab !== 'code'}
        onclick={() => (activeTab = 'code')}
      >
        Code
      </button>
      <button
        type="button"
        class="rounded px-3 py-1"
        class:bg-gray-900={activeTab === 'tests'}
        class:text-white={activeTab === 'tests'}
        class:dark:bg-gray-100={activeTab === 'tests'}
        class:dark:text-gray-900={activeTab === 'tests'}
        class:text-gray-600={activeTab !== 'tests'}
        class:dark:text-gray-300={activeTab !== 'tests'}
        onclick={() => (activeTab = 'tests')}
      >
        Tests
      </button>
      <button
        type="button"
        class="rounded px-3 py-1"
        class:bg-gray-900={activeTab === 'output'}
        class:text-white={activeTab === 'output'}
        class:dark:bg-gray-100={activeTab === 'output'}
        class:dark:text-gray-900={activeTab === 'output'}
        class:text-gray-600={activeTab !== 'output'}
        class:dark:text-gray-300={activeTab !== 'output'}
        onclick={() => (activeTab = 'output')}
      >
        Output
      </button>
    </div>
    <div class="flex flex-wrap items-center justify-end gap-2">
      <div class="flex items-center gap-1 text-sm">
        <span class="font-mono tabular-nums text-gray-700 dark:text-gray-200" aria-live="off">
          {formatElapsed(timer.elapsedMs)}
        </span>
        <button
          type="button"
          class="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          onclick={() => timer.toggle()}
          aria-label={timer.running ? 'Pause timer' : 'Start timer'}
          title={timer.running ? 'Pause timer' : 'Start timer'}
        >
          {timer.running ? 'Pause' : 'Start'}
        </button>
        <button
          type="button"
          class="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          onclick={() => timer.reset()}
          disabled={timer.elapsedMs === 0 && !timer.running}
          aria-label="Reset timer"
          title="Reset timer"
        >
          Reset
        </button>
      </div>
      <button
        type="button"
        class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        onclick={saveCode}
        disabled={!hasUnsavedCode || runState.kind === 'running' || runState.kind === 'loading' || submitState === 'submitting' || codeSaveState === 'saving'}
      >
        {codeSaveState === 'saving' ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        class="whitespace-nowrap rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        onclick={resetToStarter}
        disabled={runState.kind === 'running' || runState.kind === 'loading'}
      >
        Reset to starter
      </button>
      <button
        type="button"
        class="rounded bg-black px-3 py-1 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
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
        class="rounded bg-green-700 px-3 py-1 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-60 dark:bg-green-600 dark:hover:bg-green-500"
        onclick={submitAttempt}
        disabled={runState.kind === 'running' || runState.kind === 'loading' || submitState === 'submitting'}
      >
        {submitState === 'submitting' ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  </div>
  <div class="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-2 lg:gap-0">
    <section
      class="min-h-0 flex-1 overflow-auto border-gray-200 p-4 lg:!flex lg:flex-col lg:border-r lg:p-6 dark:border-gray-800"
      class:hidden={activeTab !== 'problem'}
    >
      <article class="prose prose-sm max-w-none dark:prose-invert">
        {@html renderedMarkdown}
      </article>
      <div class="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">
        <label for="notes" class="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Notes
        </label>
        <textarea
          id="notes"
          class="h-48 w-full rounded border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-400"
          bind:value={notes}
          placeholder="Write down observations, edge cases, and retry plan…"
        ></textarea>
        <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
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

    <section
      class="flex min-h-0 flex-1 flex-col lg:!flex"
      class:hidden={activeTab === 'problem'}
    >
      <div
        class="min-h-0 flex-1"
        class:hidden={activeTab !== 'code' && activeTab !== 'problem'}
      >
        <MonacoEditor bind:value={code} language="python" height="100%" lint={true} />
      </div>

      <div class="min-h-0 flex-1" class:hidden={activeTab !== 'tests'}>
        <MonacoEditor value={tests} language="python" readOnly={true} height="100%" />
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4" class:hidden={activeTab !== 'output'}>
        {#if runState.kind === 'idle'}
          <p class="text-sm text-gray-500 dark:text-gray-400">Click Run to execute the tests.</p>
        {:else if runState.kind === 'loading'}
          <p class="text-sm text-gray-600 dark:text-gray-300">{runState.message}</p>
        {:else if runState.kind === 'running'}
          <p class="text-sm text-gray-600 dark:text-gray-300">Running tests…</p>
        {:else if runState.kind === 'error'}
          {#if runState.timedOut}
            <p class="text-sm font-medium text-red-700 dark:text-red-400">
              Timed out after {timeoutMs / 1000}s — the worker was terminated. The next run
              will spin up a fresh interpreter.
            </p>
          {:else}
            <p class="text-sm font-medium text-red-700 dark:text-red-400">Error: {runState.message}</p>
          {/if}
        {:else if runState.kind === 'done'}
          {@const { summary, stdout, stderr, durationMs } = runState.result}
          <div class="space-y-3 text-sm">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span class="font-medium">
                {summary.passed}/{summary.total} passed
              </span>
              {#if summary.failed > 0}
                <span class="text-red-600 dark:text-red-400">{summary.failed} failed</span>
              {/if}
              {#if summary.errored > 0}
                <span class="text-red-600 dark:text-red-400">{summary.errored} errored</span>
              {/if}
              {#if summary.skipped > 0}
                <span class="text-gray-500 dark:text-gray-400">{summary.skipped} skipped</span>
              {/if}
              <span class="text-gray-500 dark:text-gray-400">{durationMs}ms</span>
            </div>
            <ul class="space-y-2">
              {#each summary.tests as t (t.name)}
                <li class="rounded border border-gray-200 p-2 dark:border-gray-800 dark:bg-gray-900">
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-block h-2 w-2 shrink-0 rounded-full"
                      class:bg-green-500={t.outcome === 'passed'}
                      class:bg-red-500={t.outcome === 'failed' || t.outcome === 'error'}
                      class:bg-gray-400={t.outcome === 'skipped'}
                    ></span>
                    <span class="min-w-0 flex-1 truncate font-mono text-xs" title={t.name}>{t.name}</span>
                    <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">{t.durationMs}ms</span>
                  </div>
                  {#if t.failureMessage}
                    <pre class="mt-2 overflow-auto rounded bg-gray-50 p-2 text-xs text-red-700 dark:bg-gray-950 dark:text-red-300">{t.failureMessage}</pre>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if stdout}
              <details>
                <summary class="cursor-pointer text-xs text-gray-500 dark:text-gray-400">stdout</summary>
                <pre class="mt-1 overflow-auto rounded bg-gray-50 p-2 text-xs dark:bg-gray-950 dark:text-gray-200">{stdout}</pre>
              </details>
            {/if}
            {#if stderr}
              <details>
                <summary class="cursor-pointer text-xs text-gray-500 dark:text-gray-400">stderr</summary>
                <pre class="mt-1 overflow-auto rounded bg-gray-50 p-2 text-xs dark:bg-gray-950 dark:text-gray-200">{stderr}</pre>
              </details>
            {/if}
          </div>
        {/if}
        {#if submitState === 'error' && submitError}
          <p class="mt-4 text-sm font-medium text-red-700 dark:text-red-400">Submit error: {submitError}</p>
        {/if}
      </div>
    </section>
  </div>
</div>
