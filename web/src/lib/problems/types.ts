/**
 * Shape of a single entry in `generated-manifest.json`. Must stay in step
 * with the validator in `scripts/generate-problems-manifest.ts`.
 */
export interface ProblemMeta {
	schema_version: 1
	id: number
	slug: string
	title: string
	difficulty: 'easy' | 'medium' | 'hard'
	pattern: Pattern
	leetcode_url: string
	recommended_minutes: number
	execution_timeout_seconds: number
	tags: string[]
	order: number
	entry_function: string
}

export type Pattern =
	| 'array'
	| 'hashmap'
	| 'two-pointer'
	| 'stack'
	| 'linked-list'
	| 'tree'
	| 'binary-search'
	| 'graph'
	| 'sliding-window'

export interface Manifest {
	problems: ProblemMeta[]
}

/** Bundle of source files loaded for a single problem on its detail page. */
export interface ProblemSources {
	meta: ProblemMeta
	markdown: string
	starter: string
	tests: string
}
