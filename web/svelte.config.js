import adapterNode from '@sveltejs/adapter-node'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapterNode({
			out: 'build',
			precompress: true,
		}),
	},
}

export default config
