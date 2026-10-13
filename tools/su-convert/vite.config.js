import {defineConfig} from 'vite'

// The conversion scripts only need Vite to serve three.js and src/ to a headless browser.
// Prebundle three up front (as the old demo config did) so the page never reloads mid-conversion.
export default defineConfig({
  optimizeDeps:{include:['three']},
})
