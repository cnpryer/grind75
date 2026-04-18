import rawManifest from './generated-manifest.json'
import type { Manifest, ProblemMeta } from './types'

const manifest = rawManifest as Manifest

export function allProblems(): ProblemMeta[] {
	return manifest.problems
}

export function findProblem(slug: string): ProblemMeta | undefined {
	return manifest.problems.find((p) => p.slug === slug)
}
