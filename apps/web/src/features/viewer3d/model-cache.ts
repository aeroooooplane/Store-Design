import type * as THREE from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { buildWhite } from './white-material.ts'

// ---- model cache: each GLB is fetched and decoded once per page ----

// Meshopt decoding runs in workers instead of blocking the page.
// three.js API, not a React hook.
// eslint-disable-next-line react-hooks/rules-of-hooks
if (typeof Worker !== 'undefined') MeshoptDecoder.useWorkers(2)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const sources = new Map<string, Promise<GLTF>>()
const whiteModels = new Map<string, Promise<THREE.Object3D>>()
// Limit fetch + decode together, so opening a dense shop cannot decode every asset at once.
const waiting: Array<() => void> = []
let active = 0
const MAX_ACTIVE = 2

function schedule<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active++
      Promise.resolve()
        .then(load)
        .then(resolve, reject)
        .finally(() => {
          active--
          waiting.shift()?.()
        })
    }
    if (active < MAX_ACTIVE) start()
    else waiting.push(start)
  })
}

/** The decoded GLB with its original materials (kept for the material renders). */
export function loadSource(url: string): Promise<GLTF> {
  let source = sources.get(url)
  if (!source) {
    source = schedule(() => loader.loadAsync(url))
    // A failed load is retried next time.
    source.catch(() => sources.delete(url))
    sources.set(url, source)
  }
  return source
}

export function loadModel(url: string): Promise<THREE.Object3D> {
  let model = whiteModels.get(url)
  if (!model) {
    model = loadSource(url).then(buildWhite)
    model.catch(() => whiteModels.delete(url))
    whiteModels.set(url, model)
  }
  return model
}
