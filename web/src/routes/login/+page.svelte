<script lang="ts">
import { enhance } from '$app/forms'

let { form } = $props()

let submitting = $state(false)
</script>

<svelte:head>
  <title>Sign in · grind75</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
  <h1 class="mb-6 text-2xl font-semibold tracking-tight">grind75</h1>
  <form
    method="POST"
    class="space-y-4"
    use:enhance={() => {
      submitting = true
      return async ({ update }) => {
        try {
          await update()
        } finally {
          submitting = false
        }
      }
    }}
  >
    <label class="block">
      <span class="block text-sm font-medium text-gray-700">Username</span>
      <input
        type="text"
        name="username"
        autocomplete="username"
        required
        value={form?.username ?? ''}
        class="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
    </label>
    <label class="block">
      <span class="block text-sm font-medium text-gray-700">Password</span>
      <input
        type="password"
        name="password"
        autocomplete="current-password"
        required
        class="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
    </label>

    {#if form?.error}
      <p class="text-sm text-red-600" role="alert">{form.error}</p>
    {/if}

    <button
      type="submit"
      disabled={submitting}
      class="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
    >
      {submitting ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</main>
