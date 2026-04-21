import { browser } from '$app/environment'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'grind75:theme'

function readStoredPreference(): ThemePreference {
	if (!browser) return 'system'
	const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
	if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
	return 'system'
}

function systemPrefersDark(): boolean {
	if (!browser) return false
	return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
	if (pref === 'system') return systemDark ? 'dark' : 'light'
	return pref
}

function applyToDocument(resolved: ResolvedTheme): void {
	if (!browser) return
	const root = document.documentElement
	if (resolved === 'dark') root.classList.add('dark')
	else root.classList.remove('dark')
	root.style.colorScheme = resolved
}

class ThemeStore {
	preference = $state<ThemePreference>(browser ? readStoredPreference() : 'system')
	systemDark = $state(browser ? systemPrefersDark() : false)
	resolved = $derived<ResolvedTheme>(resolve(this.preference, this.systemDark))

	private mql: MediaQueryList | null = null
	private mqlHandler: ((e: MediaQueryListEvent) => void) | null = null

	init(): void {
		if (!browser) return
		this.preference = readStoredPreference()
		this.systemDark = systemPrefersDark()
		this.mql = window.matchMedia('(prefers-color-scheme: dark)')
		this.mqlHandler = (e) => {
			this.systemDark = e.matches
			applyToDocument(this.resolved)
		}
		this.mql.addEventListener('change', this.mqlHandler)
		applyToDocument(this.resolved)
	}

	setPreference(next: ThemePreference): void {
		this.preference = next
		if (browser) {
			window.localStorage.setItem(THEME_STORAGE_KEY, next)
			applyToDocument(this.resolved)
		}
	}

	dispose(): void {
		if (this.mql && this.mqlHandler) {
			this.mql.removeEventListener('change', this.mqlHandler)
		}
		this.mql = null
		this.mqlHandler = null
	}
}

export const theme = new ThemeStore()
