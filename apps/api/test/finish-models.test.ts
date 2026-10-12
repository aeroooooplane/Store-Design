import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Document, NodeIO } from '@gltf-transform/core'
import type { Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { FRONT_ONLY, buildFinishModel } from '../src/modules/assets/finish-models.ts'

let dir: string

const png = (r: number, g: number, b: number, size = 8) =>
  sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer()
/** A speckled stone texture (a plain one would be folded into the colour by prune). */
const stoneTexture = () =>
  sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: '#ffffff',
      noise: { type: 'gaussian', mean: 230, sigma: 20 },
    },
  })
    .png()
    .toBuffer()

/**
 * A 1.8 m table edge band whose outside is dark metal and inside the white top material (two
 * coincident layers, as SketchUp exports a face with two materials), a big textured top, and
 * 30 tiny textured patches of 1 cm² each with its own material, as SketchUp's projected
 * textures arrive.
 */
async function writeModel(file: string) {
  const document = new Document()
  const buffer = document.createBuffer()
  const root = document.getRoot()
  const scene = document.createScene()
  root.setDefaultScene(scene)
  const prim = (material: string | null, positions: number[], uv = false): Primitive => {
    const p = document
      .createPrimitive()
      .setAttribute(
        'POSITION',
        document
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(positions))
          .setBuffer(buffer),
      )
    if (uv) {
      const count = positions.length / 3
      p.setAttribute(
        'TEXCOORD_0',
        document
          .createAccessor()
          .setType('VEC2')
          .setArray(new Float32Array(count * 2).map((_, i) => (i % 3) / 2))
          .setBuffer(buffer),
      )
    }
    const found = root.listMaterials().find((m) => m.getName() === material)
    if (found) p.setMaterial(found)
    return p
  }
  const material = (name: string, color: [number, number, number, number]) =>
    document.createMaterial(name).setBaseColorFactor(color)
  material('Metal_06_1K', [0.1, 0.1, 0.1, 1])
  const stone = material('中岛桌面人造石', [1, 1, 1, 1]).setBaseColorTexture(
    document
      .createTexture('stone')
      .setMimeType('image/png')
      .setImage(new Uint8Array(await stoneTexture())),
  )
  // Outside of the band faces +z; the inside layer is the same quad wound the other way.
  const quad = [
    -0.9, 0.7, 0.4, 0.9, 0.7, 0.4, 0.9, 0.9, 0.4, -0.9, 0.7, 0.4, 0.9, 0.9, 0.4, -0.9, 0.9, 0.4,
  ]
  const reversed: number[] = []
  for (let t = 0; t < 2; t++) {
    const tri = quad.slice(t * 9, t * 9 + 9)
    reversed.push(...tri.slice(0, 3), ...tri.slice(6, 9), ...tri.slice(3, 6))
  }
  const top = [
    -0.9, 0.9, -0.4, 0.9, 0.9, -0.4, 0.9, 0.9, 0.4, -0.9, 0.9, -0.4, 0.9, 0.9, 0.4, -0.9, 0.9, 0.4,
  ]
  const mesh = document
    .createMesh('table')
    .addPrimitive(prim('Metal_06_1K', quad))
    .addPrimitive(prim('中岛桌面人造石', [...reversed, ...top], true))
  expect(stone.listParents().length).toBeGreaterThan(0)
  for (let i = 0; i < 30; i++) {
    const x = -0.8 + i * 0.05
    material(`patch-${i}`, [1, 1, 1, 1]).setBaseColorTexture(
      document
        .createTexture(`patch-${i}`)
        .setMimeType('image/png')
        .setImage(new Uint8Array(await png(200, 30, 30))),
    )
    mesh.addPrimitive(prim(`patch-${i}`, [x, 1, 0, x + 0.01, 1, 0, x, 1.01, 0], true))
  }
  scene.addChild(document.createNode('table').setMesh(mesh))
  // Something reaches the floor so the box spans 0 – 1.01 m.
  const leg = document
    .createMesh('leg')
    .addPrimitive(prim('Metal_06_1K', [0, 0, 0, 0.02, 0, 0, 0, 0.7, 0]))
  scene.addChild(document.createNode('leg').setMesh(leg))
  await writeFile(file, await new NodeIO().writeBinary(document))
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'finish-models-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('buildFinishModel', () => {
  it('joins parts, flattens tiny patches and marks the two sides of SketchUp faces', async () => {
    const source = path.join(dir, 'model.glb')
    const target = path.join(dir, 'finish.glb')
    await writeModel(source)
    const record = await buildFinishModel(source, target)

    expect(record.drawsBefore).toBe(33)
    expect(record.specks).toBe(30)
    // The band's outside and inside: two triangles each.
    expect(record.pairedTriangles).toBe(4)
    expect(record.driftM).toBeLessThan(0.001)
    // Metal outside, stone inside (both front-only), the stone top, the patches, the leg.
    expect(record.drawsAfter).toBeLessThanOrEqual(5)

    await MeshoptDecoder.ready
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    const result = await io.readBinary(new Uint8Array(await readFile(target)))
    const materials = result.getRoot().listMaterials()
    const front = materials.filter((m) => m.getExtras()[FRONT_ONLY] === true)
    expect(front.map((m) => m.getName()).sort()).toEqual([
      'Metal_06_1K · front',
      '中岛桌面人造石 · front',
    ])
    expect(front.every((m) => !m.getDoubleSided())).toBe(true)
    // The patches share one plain material and carry their colour in the vertices.
    const patches = result
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .filter((p) => p.getMaterial()?.getName() === '色块')
    expect(patches).toHaveLength(1)
    const colors = patches[0]?.getAttribute('COLOR_0')
    expect(colors?.getCount()).toBeGreaterThan(0)
    const [r = 0, g = 0] = colors?.getElement(0, []) ?? []
    expect(r).toBeGreaterThan(0.5)
    expect(g).toBeLessThan(0.05)
    expect(result.getRoot().listTextures()).toHaveLength(1)
    // No stored normals: the viewer shades flat.
    expect(
      result
        .getRoot()
        .listMeshes()
        .flatMap((m) => m.listPrimitives())
        .some((p) => p.getAttribute('NORMAL')),
    ).toBe(false)
  })
})
