<script lang="ts">
import { goto } from '$app/navigation'
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
      problems: groups.get(pattern) ?? [],
    }))
    .filter((group) => group.problems.length > 0)
})
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
  <div class="space-y-8">
    {#each grouped as group (group.pattern)}
      <section>
        <h2 class="mb-3 text-lg font-medium">{group.label}</h2>
        <ul class="space-y-2">
          {#each group.problems as problem (problem.slug)}
            <li>
              <a
                href={`/problem/${problem.slug}`}
                class="flex items-center justify-between rounded border border-gray-200 px-4 py-3 hover:bg-gray-50"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-gray-900">{problem.title}</p>
                  <p class="text-xs text-gray-500">#{problem.order} · {problem.slug}</p>
                </div>
                <span class="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-600">
                  {problem.difficulty}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</main>
