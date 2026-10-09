import {defineConfig} from 'vite'
import {fileURLToPath} from 'node:url'
import evidence from './src/data/case-library.json'
import {localEvidencePlugin} from './server/local-evidence.mjs'
import {localModelLibraryPlugin} from './server/local-model-library.mjs'
import {resourceModelsPlugin} from './server/resource-models.mjs'
import placements from './src/data/placement-manifest.json'

export default defineConfig({
  plugins:[resourceModelsPlugin(fileURLToPath(new URL('../',import.meta.url)),placements.assets),localModelLibraryPlugin(fileURLToPath(new URL('../',import.meta.url))),localEvidencePlugin(fileURLToPath(new URL('../',import.meta.url)),evidence.stores)],
  cacheDir:process.env.VITE_CACHE_DIR||'node_modules/.vite',
  // Prebundle lazy export/viewer dependencies before the first user interaction.
  // Otherwise Vite can reload the page when ZIP export is clicked for the first time.
  optimizeDeps:{include:[
    'three',
    'three/addons/libs/fflate.module.js',
    'three/addons/loaders/GLTFLoader.js',
    'three/addons/libs/meshopt_decoder.module.js',
    'three/addons/controls/OrbitControls.js',
    'three/addons/environments/RoomEnvironment.js',
    'three/addons/postprocessing/EffectComposer.js',
    'three/addons/postprocessing/RenderPass.js',
    'three/addons/postprocessing/SSAOPass.js',
    'three/addons/postprocessing/OutputPass.js',
    'three/addons/exporters/GLTFExporter.js',
  ]},
})
