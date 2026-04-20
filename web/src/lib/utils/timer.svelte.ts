export class Timer {
	elapsedMs = $state(0)
	running = $state(false)
	private accumulated = 0
	private startedAt: number | null = null
	private intervalId: ReturnType<typeof setInterval> | null = null

	start() {
		if (this.running) return
		this.running = true
		this.startedAt = Date.now()
		this.intervalId = setInterval(() => {
			if (this.startedAt !== null) {
				this.elapsedMs = this.accumulated + (Date.now() - this.startedAt)
			}
		}, 1000)
	}

	stop() {
		if (!this.running) return
		if (this.startedAt !== null) {
			this.accumulated += Date.now() - this.startedAt
			this.elapsedMs = this.accumulated
		}
		this.startedAt = null
		this.running = false
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = null
		}
	}

	toggle() {
		if (this.running) this.stop()
		else this.start()
	}

	reset() {
		this.stop()
		this.accumulated = 0
		this.elapsedMs = 0
	}

	dispose() {
		this.stop()
	}
}

export function formatElapsed(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	const mm = String(minutes).padStart(2, '0')
	const ss = String(seconds).padStart(2, '0')
	if (hours > 0) {
		return `${hours}:${mm}:${ss}`
	}
	return `${mm}:${ss}`
}

/**
 * Coarse, human-readable formatter for cumulative totals shown on the
 * dashboard (e.g. "1h 23m", "12m", "45s"). Intentionally less precise than
 * `formatElapsed` — callers care about magnitude, not seconds.
 */
export function formatCumulativeElapsed(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000)
	if (totalSeconds < 60) {
		return `${totalSeconds}s`
	}
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	if (hours > 0) {
		return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
	}
	return `${minutes}m`
}
