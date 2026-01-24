import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		paths: {
			// Para GitHub Pages, cambiar esto al nombre del repo
			base: process.argv.includes('dev') ? '' : '/TSJ_Filing_online'
		},
		appDir: 'app'
	}
};

export default config;
