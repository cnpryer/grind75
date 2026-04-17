<script lang="ts">
import { goto } from '$app/navigation'

let { data } = $props()

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  await goto('/login')
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
  <p class="text-gray-600">Dashboard placeholder — M3 renders the 13 Grind75 easys here.</p>
</main>
