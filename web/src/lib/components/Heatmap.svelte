<script lang="ts">
import type { HeatmapCell } from '$lib/api/client'

interface Props {
  cells: HeatmapCell[]
  weeks?: number
}

let { cells, weeks = 53 }: Props = $props()

const DAYS_PER_WEEK = 7

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

function colorClass(count: number, future: boolean): string {
  if (future) return 'bg-transparent'
  if (count === 0) return 'bg-gray-100'
  if (count <= 2) return 'bg-green-200'
  if (count <= 5) return 'bg-green-400'
  if (count <= 9) return 'bg-green-600'
  return 'bg-green-800'
}

function tooltip(day: DayCell): string {
  if (day.future) return ''
  return day.count === 0
    ? `No attempts on ${day.date}`
    : `${day.count} attempt${day.count === 1 ? '' : 's'} on ${day.date}`
}

// Flip tooltip anchor at the grid edges so the ~180px-wide pill
// stays inside the scroll container instead of getting clipped.
function tooltipAnchor(colIndex: number, totalCols: number): string {
  if (colIndex < 4) return 'left-0'
  if (colIndex > totalCols - 5) return 'right-0'
  return 'left-1/2 -translate-x-1/2'
}
</script>

<section class="mb-6">
  <div class="mb-2 flex items-baseline justify-between">
    <h2 class="text-sm font-medium text-gray-700">Activity</h2>
    <span class="text-xs text-gray-500">
      {totalAttempts} attempt{totalAttempts === 1 ? '' : 's'} · last {weeks} weeks
    </span>
  </div>
  <div class="flex gap-0.5" aria-label="Submission heatmap">
    {#each columns as column, colIndex (column.days[0].date)}
        <div class="flex flex-col gap-0.5">
          <div class="h-3 text-[10px] leading-none text-gray-500">
            {column.monthLabel ?? ''}
          </div>
          {#each column.days as day (day.date)}
            <div class="group relative">
              <div
                class={`h-2.5 w-2.5 rounded-sm ${colorClass(day.count, day.future)}`}
                aria-hidden={day.future}
              ></div>
              {#if !day.future}
                <div
                  role="tooltip"
                  class={`pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block ${tooltipAnchor(colIndex, columns.length)}`}
                >
                  {tooltip(day)}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
  </div>
</section>
