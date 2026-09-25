import {defineConfig} from 'vite'

export default defineConfig({
  cacheDir:process.env.VITE_CACHE_DIR||'node_modules/.vite',
  // Prebundle lazy export/viewer dependencies before the first user interaction.
  // Otherwise Vite can reload the page when ZIP export is clicked for the first time.
  optimizeDeps:{include:[
    'three',
    'three/addons/libs/fflate.module.js',
    'three/addons/loaders/GLTFLoader.js',
    'three/addons/controls/OrbitControls.js',
    'three/addons/exporters/GLTFExporter.js',
  ]},
})
