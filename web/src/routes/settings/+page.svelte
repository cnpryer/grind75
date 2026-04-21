<script lang="ts">
import { enhance } from '$app/forms'
import { goto } from '$app/navigation'
import type { SettingsRecord } from '$lib/api/client'
import { type ThemePreference, theme } from '$lib/utils/theme.svelte'

let { data } = $props()

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// Split "authoritative server value" from "optimistic override" so we can flip
// the checkbox instantly while the action is in flight. `optimistic` is cleared
// once the load re-runs (after update()) or when the save fails.
let optimistic = $state<SettingsRecord | null>(null)
const autoStartTimer = $derived(optimistic?.auto_start_timer ?? data.settings.auto_start_timer)
const lastSavedAt = $derived(optimistic?.updated_at ?? data.settings.updated_at)

let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
let saveError = $state<string | null>(null)

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  await goto('/login')
}
</script>

<svelte:head>
  <title>Settings — grind75</title>
</svelte:head>

<main class="mx-auto max-w-2xl p-4 sm:p-8">
  <header class="mb-8 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-baseline gap-4">
      <a href="/" class="text-sm text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white">← grind75</a>
      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">Settings</h1>
    </div>
    <div class="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
      <span>{data.user?.username}</span>
      <button type="button" class="text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white" onclick={logout}>
        Sign out
      </button>
    </div>
  </header>

  <section class="mb-6 rounded border border-gray-200 p-5 dark:border-gray-800 dark:bg-gray-900">
    <h2 class="mb-4 text-lg font-medium">Appearance</h2>
    <fieldset>
      <legend class="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Theme</legend>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
        {#each themeOptions as option (option.value)}
          <button
            type="button"
            role="radio"
            class="rounded border px-3 py-1 text-sm"
            class:border-gray-900={theme.preference === option.value}
            class:bg-gray-900={theme.preference === option.value}
            class:text-white={theme.preference === option.value}
            class:dark:border-gray-100={theme.preference === option.value}
            class:dark:bg-gray-100={theme.preference === option.value}
            class:dark:text-gray-900={theme.preference === option.value}
            class:border-gray-300={theme.preference !== option.value}
            class:text-gray-700={theme.preference !== option.value}
            class:hover:bg-gray-100={theme.preference !== option.value}
            class:dark:border-gray-700={theme.preference !== option.value}
            class:dark:text-gray-300={theme.preference !== option.value}
            class:dark:hover:bg-gray-800={theme.preference !== option.value}
            aria-checked={theme.preference === option.value}
            onclick={() => theme.setPreference(option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Currently using <span class="font-mono">{theme.resolved}</span> theme.
      </p>
    </fieldset>
  </section>

  <section class="rounded border border-gray-200 p-5 dark:border-gray-800 dark:bg-gray-900">
    <h2 class="mb-4 text-lg font-medium">Timer</h2>
    <form
      method="POST"
      action="?/updateSettings"
      use:enhance={({ formData }) => {
        // Normalise checkbox: "on" when checked, absent when not.
        // Set an explicit boolean string so the action can parse it cleanly.
        const next = formData.has('auto_start_timer')
        formData.set('auto_start_timer', String(next))
        // Optimistic update so the UI responds instantly.
        optimistic = { auto_start_timer: next, updated_at: new Date().toISOString() }
        saveState = 'saving'
        saveError = null

        return async ({ result, update }) => {
          if (result.type === 'success' && result.data?.settings) {
            optimistic = result.data.settings as SettingsRecord
            saveState = 'saved'
          } else if (result.type === 'failure') {
            saveState = 'error'
            saveError = (result.data?.error as string) ?? 'Failed to save settings'
            optimistic = null
          }
          // Re-run load functions (refreshes other pages that depend on settings)
          // without resetting the form. Clears `optimistic` below once data updates.
          await update({ reset: false })
          if (result.type === 'success') optimistic = null
        }
      }}
    >
      <label class="flex items-start gap-3">
        <input
          type="checkbox"
          name="auto_start_timer"
          class="mt-1 h-4 w-4"
          checked={autoStartTimer}
          onchange={(e) => (e.currentTarget as HTMLInputElement).form?.requestSubmit()}
          disabled={saveState === 'saving'}
        />
        <span>
          <span class="block text-sm font-medium text-gray-900 dark:text-gray-100">Auto-start timer on problem open</span>
          <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
            When enabled, the per-problem timer starts automatically as soon as you open a
            problem page. Otherwise you start it manually.
          </span>
        </span>
      </label>
      <div class="mt-3 text-xs">
        {#if saveState === 'saving'}
          <span class="text-gray-500 dark:text-gray-400">Saving…</span>
        {:else if saveState === 'saved'}
          <span class="text-green-700 dark:text-green-400">Saved · last updated {new Date(lastSavedAt).toLocaleString()}</span>
        {:else if saveState === 'error'}
          <span class="text-red-700 dark:text-red-400">{saveError}</span>
        {:else}
          <span class="text-gray-500 dark:text-gray-400">Last updated {new Date(lastSavedAt).toLocaleString()}</span>
        {/if}
      </div>
    </form>
  </section>
</main>
