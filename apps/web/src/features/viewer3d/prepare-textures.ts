import * as THREE from 'three'
import { isDrawable } from './scene-geometry.ts'

interface Uploads {
  textures: WeakMap<THREE.Texture, Promise<void>>
  tail: Promise<void>
}
const uploads = new WeakMap<THREE.WebGLRenderer, Uploads>()
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Upload reviewed PBR textures one per frame, before the model joins the scene. */
export async function prepareModelTextures(
  renderer: THREE.WebGLRenderer,
  root: THREE.Object3D,
  cancelled: () => boolean = () => false,
) {
  let state = uploads.get(renderer)
  if (!state) {
    state = { textures: new WeakMap(), tail: Promise.resolve() }
    uploads.set(renderer, state)
  }
  const pending: Promise<void>[] = []
  root.traverse((node) => {
    if (!isDrawable(node)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material.userData['storeDesignPreserveAppearance'] !== true) continue
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture)) continue
        const texture = value as THREE.Texture
        let ready = state.textures.get(texture)
        if (!ready) {
          ready = state.tail.then(nextFrame).then(() => {
            if (cancelled()) throw new Error('三维视图已关闭')
            renderer.initTexture(texture)
          })
          state.textures.set(texture, ready)
          ready.catch(() => state.textures.delete(texture))
          state.tail = ready.catch(() => undefined)
        }
        pending.push(ready)
      }
    }
  })
  await Promise.all(pending)
}
