import { afterEach, expect, it, vi } from 'vitest'
import { rectangleSpace } from '@store/shared'
import { contextFloor } from './context-floor.ts'
import { disposeGeometry } from './scene-geometry.ts'

afterEach(() => vi.restoreAllMocks())
it('外扩一米，地砖本体不改写，外圈独有的遮罩与材质在重建时释放', () => {
  const context = new Proxy({}, { get: () => () => undefined, set: () => true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as CanvasRenderingContext2D,
  )
  const space = rectangleSpace(8, 6, 3),
    before = structuredClone(space)
  for (const shop of ['side_hall', 'island'] as const) {
    const mesh = contextFloor(space, shop)!
    mesh.geometry.computeBoundingBox()
    expect(mesh.geometry.boundingBox!.min.x).toBe(-1)
    expect(mesh.geometry.boundingBox!.max.x).toBe(9)
    expect(mesh.geometry.boundingBox!.min.z).toBe(-1)
    expect(mesh.geometry.boundingBox!.max.z).toBe(7)
    expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(shop === 'island' ? -0.03 : 0)
    expect(mesh.material.opacity).toBe(0.24)
    expect(mesh.material.depthWrite).toBe(false)
    const disposed = [
      vi.spyOn(mesh.geometry, 'dispose'),
      vi.spyOn(mesh.material, 'dispose'),
      vi.spyOn(mesh.material.alphaMap!, 'dispose'),
    ]
    disposeGeometry(mesh)
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1)
  }
  expect(space).toEqual(before)
})
