<script lang="ts">
import { goto } from '$app/navigation'
import type { ProgressRecord } from '$lib/api/client'
import Heatmap from '$lib/components/Heatmap.svelte'
import type { ProblemMeta } from '$lib/problems/types'

let { data } = $props()

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  await goto('/login')
}

const patternOrder = [
  'array',
  'hashmap',
  'two-pointer',
  'stack',
  'linked-list',
  'tree',
  'binary-search',
  'graph',
  'sliding-window',
] as const

const patternLabels: Record<(typeof patternOrder)[number], string> = {
  array: 'Array',
  hashmap: 'Hashmap',
  'two-pointer': 'Two Pointer',
  stack: 'Stack',
  'linked-list': 'Linked List',
  tree: 'Tree',
  'binary-search': 'Binary Search',
  graph: 'Graph',
  'sliding-window': 'Sliding Window',
}

const grouped = $derived.by(() => {
  const progressBySlug = new Map<string, ProgressRecord>(
    ((data.progress ?? []) as ProgressRecord[]).map((record) => [record.slug, record]),
  )
  const groups = new Map<string, ProblemMeta[]>()
  for (const problem of data.problems as ProblemMeta[]) {
    if (!groups.has(problem.pattern)) {
      groups.set(problem.pattern, [])
    }
    groups.get(problem.pattern)?.push(problem)
  }
  return patternOrder
    .map((pattern) => ({
      pattern,
      label: patternLabels[pattern],
      problems: (groups.get(pattern) ?? []).map((problem) => ({
        problem,
        progress: progressBySlug.get(problem.slug),
      })),
    }))
    .filter((group) => group.problems.length > 0)
})

const statusLabel: Record<string, string> = {
  not_started: 'Not started',
  attempted: 'Attempted',
  solved: 'Solved',
}
</script>

<svelte:head>
  <title>grind75</title>
</svelte:head>

<main class="mx-auto max-w-3xl p-8">
  <header class="mb-8 flex items-center justify-between">
    <h1 class="text-3xl font-semibold tracking-tight">grind75</h1>
    <div class="flex items-center gap-3 text-sm text-gray-600">
      <span>{data.user?.username}</span>
      <button type="button" class="text-gray-500 hover:text-black" onclick={logout}>
        Sign out
      </button>
    </div>
  </header>
  <Heatmap cells={data.heatmap ?? []} />
  <div class="space-y-8">
    {#each grouped as group (group.pattern)}
      <section>
        <h2 class="mb-3 text-lg font-medium">{group.label}</h2>
        <ul class="space-y-2">
          {#each group.problems as entry (entry.problem.slug)}
            <li>
              <a
                href={`/problem/${entry.problem.slug}`}
                class="flex items-center justify-between rounded border border-gray-200 px-4 py-3 hover:bg-gray-50"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-gray-900">{entry.problem.title}</p>
                  <p class="text-xs text-gray-500">
                    #{entry.problem.order} · {entry.problem.slug}
                    {#if entry.progress}
                      · {entry.progress.attempt_count} attempt{entry.progress.attempt_count === 1 ? '' : 's'}
                    {/if}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-600">
                    {entry.problem.difficulty}
                  </span>
                  <span
                    class="rounded px-2 py-0.5 text-xs"
                    class:bg-gray-100={!entry.progress || entry.progress.status === 'not_started'}
                    class:text-gray-600={!entry.progress || entry.progress.status === 'not_started'}
                    class:bg-amber-100={entry.progress?.status === 'attempted'}
                    class:text-amber-700={entry.progress?.status === 'attempted'}
                    class:bg-green-100={entry.progress?.status === 'solved'}
                    class:text-green-700={entry.progress?.status === 'solved'}
                  >
                    {statusLabel[entry.progress?.status ?? 'not_started']}
                  </span>
                </div>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</main>
