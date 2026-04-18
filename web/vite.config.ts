import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
	plugins: [sveltekit()],
	css: {
		postcss: './postcss.config.js',
	},
	// Pyodide is self-hosted from /static/pyodide/ and loaded at runtime by the
	// worker; Vite's dep-optimizer must not touch it.
	optimizeDeps: {
		exclude: ['pyodide'],
	},
	build: {
		cssMinify: true,
		minify: 'esbuild',
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					if (id.includes('node_modules')) {
						if (id.includes('monaco-editor')) return 'monaco-editor'
						if (id.includes('pyodide')) return 'pyodide'
						if (id.includes('svelte')) return 'vendor-svelte'
						return 'vendor'
					}
				},
			},
		},
	},
	test: {
		environment: 'happy-dom',
		include: ['src/**/*.{test,spec}.{js,ts}'],
		globals: true,
	},
}))
