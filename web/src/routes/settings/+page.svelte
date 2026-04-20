<script lang="ts">
import { goto, invalidateAll } from '$app/navigation'
import type { SettingsRecord } from '$lib/api/client'

let { data } = $props()

// Split "authoritative server value" from "optimistic override" so we can flip
// the checkbox instantly while the PUT is in flight. `optimistic` is cleared
// whenever the load re-runs (after invalidateAll) or when the save fails.
let optimistic = $state<SettingsRecord | null>(null)
const autoStartTimer = $derived(optimistic?.auto_start_timer ?? data.settings.auto_start_timer)
const lastSavedAt = $derived(optimistic?.updated_at ?? data.settings.updated_at)

let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
let saveError = $state<string | null>(null)

async function toggleAutoStart(e: Event) {
  const target = e.currentTarget as HTMLInputElement
  const next = target.checked
  // Optimistic update so the UI responds instantly.
  optimistic = {
    auto_start_timer: next,
    updated_at: new Date().toISOString(),
  }
  saveState = 'saving'
  saveError = null
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_start_timer: next }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string
        message?: string
      } | null
      const detail = body?.message ?? body?.error
      throw new Error(detail ?? `Failed to save settings (${res.status})`)
    }
    const updated: SettingsRecord = await res.json()
    optimistic = updated
    saveState = 'saved'
    // Refresh other loaders (e.g. problem page) so the new setting is picked
    // up on next navigation without a hard reload. Clears `optimistic` below.
    await invalidateAll()
    optimistic = null
  } catch (err) {
    saveState = 'error'
    saveError = err instanceof Error ? err.message : 'Failed to save settings'
    // Roll back to the server's value.
    optimistic = null
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  await goto('/login')
}
</script>

<svelte:head>
  <title>Settings — grind75</title>
</svelte:head>

<main class="mx-auto max-w-2xl p-8">
  <header class="mb-8 flex items-center justify-between">
    <div class="flex items-baseline gap-4">
      <a href="/" class="text-sm text-gray-500 hover:text-black">← grind75</a>
      <h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
    </div>
    <div class="flex items-center gap-3 text-sm text-gray-600">
      <span>{data.user?.username}</span>
      <button type="button" class="text-gray-500 hover:text-black" onclick={logout}>
        Sign out
      </button>
    </div>
  </header>

  <section class="rounded border border-gray-200 p-5">
    <h2 class="mb-4 text-lg font-medium">Timer</h2>
    <label class="flex items-start gap-3">
      <input
        type="checkbox"
        class="mt-1 h-4 w-4"
        checked={autoStartTimer}
        onchange={toggleAutoStart}
        disabled={saveState === 'saving'}
      />
      <span>
        <span class="block text-sm font-medium text-gray-900">Auto-start timer on problem open</span>
        <span class="mt-0.5 block text-xs text-gray-500">
          When enabled, the per-problem timer starts automatically as soon as you open a
          problem page. Otherwise you start it manually.
        </span>
      </span>
    </label>
    <div class="mt-3 text-xs">
      {#if saveState === 'saving'}
        <span class="text-gray-500">Saving…</span>
      {:else if saveState === 'saved'}
        <span class="text-green-700">Saved · last updated {new Date(lastSavedAt).toLocaleString()}</span>
      {:else if saveState === 'error'}
        <span class="text-red-700">{saveError}</span>
      {:else}
        <span class="text-gray-500">Last updated {new Date(lastSavedAt).toLocaleString()}</span>
      {/if}
    </div>
  </section>
</main>
