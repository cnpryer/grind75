<script lang="ts">
import { onDestroy } from 'svelte'
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

// svelte-ignore state_referenced_locally
let code = $state(data.problem.starter)
let activeTab = $state<'code' | 'tests' | 'output'>('code')

// When the user navigates to a different slug, SvelteKit reuses this component
// and updates `data` in place. Snap the editor back to the new starter.
// svelte-ignore state_referenced_locally
let lastSlug = meta.slug
$effect(() => {
  if (meta.slug !== lastSlug) {
    lastSlug = meta.slug
    code = starter
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
  | { kind: 'done'; result: RunResult }
  | { kind: 'error'; message: string; timedOut: boolean }

let runState = $state<RunState>({ kind: 'idle' })

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
})

async function runTests() {
  const r = getRunner()
  runState = r.isReady ? { kind: 'running' } : { kind: 'loading', message: 'Loading Python…' }
  try {
    const result = await r.run({
      code,
      tests,
      entryFunction: meta.entry_function,
      timeoutMs,
    })
    runState = { kind: 'done', result }
    activeTab = 'output'
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
            disabled={runState.kind === 'running' || runState.kind === 'loading'}
          >
            {runState.kind === 'running'
              ? 'Running…'
              : runState.kind === 'loading'
                ? 'Loading…'
                : 'Run'}
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1" class:hidden={activeTab !== 'code'}>
        <MonacoEditor bind:value={code} language="python" height="100%" />
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
      </div>
    </section>
  </div>
</div>
