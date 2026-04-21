<script lang="ts">
import { onDestroy, onMount } from 'svelte'
import { theme } from '$lib/utils/theme.svelte'
import '../app.css'

let { children } = $props()

onMount(() => {
  theme.init()
})

onDestroy(() => {
  theme.dispose()
})
</script>

{@render children()}
