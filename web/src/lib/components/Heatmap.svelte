<script lang="ts">
import type { HeatmapCell } from '$lib/api/client'

interface Props {
  cells: HeatmapCell[]
  weeks?: number
}

let { cells, weeks = 53 }: Props = $props()

const DAYS_PER_WEEK = 7
// Approximate rendered width of the tooltip pill — used to clamp it inside
// the viewport so the right/left edges of the scroll track don't cut it off.
const TOOLTIP_HALF_WIDTH = 95

interface DayCell {
  date: string
  count: number
  future: boolean
}

interface WeekColumn {
  monthLabel: string | null
  days: DayCell[]
}

const columns = $derived.by<WeekColumn[]>(() => {
  const byDate = new Map(cells.map((c) => [c.date, c.count]))
  const now = new Date()
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const lastSunday = new Date(endUtc)
  lastSunday.setUTCDate(endUtc.getUTCDate() - endUtc.getUTCDay())
  const firstSunday = new Date(lastSunday)
  firstSunday.setUTCDate(lastSunday.getUTCDate() - 7 * (weeks - 1))

  const result: WeekColumn[] = []
  let lastMonth = -1
  for (let w = 0; w < weeks; w++) {
    const days: DayCell[] = []
    let monthLabel: string | null = null
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      const cellDate = new Date(firstSunday)
      cellDate.setUTCDate(firstSunday.getUTCDate() + w * 7 + d)
      const iso = cellDate.toISOString().slice(0, 10)
      const future = cellDate.getTime() > endUtc.getTime()
      days.push({ date: iso, count: byDate.get(iso) ?? 0, future })
      if (d === 0) {
        const month = cellDate.getUTCMonth()
        if (month !== lastMonth) {
          monthLabel = cellDate.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
          lastMonth = month
        }
      }
    }
    result.push({ monthLabel, days })
  }
  return result
})

const totalAttempts = $derived(cells.reduce((sum, c) => sum + c.count, 0))

let hovered: DayCell | null = $state(null)
let tooltipLeft = $state(0)
let tooltipTop = $state(0)

function colorClass(count: number, future: boolean): string {
  if (future) return 'bg-transparent'
  if (count === 0) return 'bg-gray-100'
  if (count <= 2) return 'bg-green-200'
  if (count <= 5) return 'bg-green-400'
  if (count <= 9) return 'bg-green-600'
  return 'bg-green-800'
}

function tooltipText(day: DayCell): string {
  return day.count === 0
    ? `No attempts on ${day.date}`
    : `${day.count} attempt${day.count === 1 ? '' : 's'} on ${day.date}`
}

function showTooltip(event: MouseEvent, day: DayCell): void {
  if (day.future) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const cellCenter = rect.left + rect.width / 2
  tooltipLeft = Math.min(
    Math.max(cellCenter, TOOLTIP_HALF_WIDTH + 4),
    window.innerWidth - TOOLTIP_HALF_WIDTH - 4,
  )
  tooltipTop = rect.top - 6
  hovered = day
}

function hideTooltip(): void {
  hovered = null
}
</script>

<section class="mb-6">
  <div class="mb-2 flex items-baseline justify-between">
    <h2 class="text-sm font-medium text-gray-700">Activity</h2>
    <span class="text-xs text-gray-500">
      {totalAttempts} attempt{totalAttempts === 1 ? '' : 's'} · last {weeks} weeks
    </span>
  </div>
  <div class="overflow-x-auto" onscroll={hideTooltip}>
    <div class="flex gap-0.5" role="img" aria-label="Submission heatmap">
      {#each columns as column (column.days[0].date)}
        <div class="flex flex-col gap-0.5">
          <div class="h-3 text-[10px] leading-none text-gray-500">
            {column.monthLabel ?? ''}
          </div>
          {#each column.days as day (day.date)}
            <div
              class={`h-2.5 w-2.5 rounded-sm ${colorClass(day.count, day.future)}`}
              aria-hidden={day.future}
              onmouseenter={(e) => showTooltip(e, day)}
              onmouseleave={hideTooltip}
            ></div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</section>

{#if hovered}
  <div
    role="tooltip"
    class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg"
    style:left="{tooltipLeft}px"
    style:top="{tooltipTop}px"
  >
    {tooltipText(hovered)}
  </div>
{/if}
