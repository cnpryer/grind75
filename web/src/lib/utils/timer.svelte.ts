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
