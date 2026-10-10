import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Document, NodeIO } from '@gltf-transform/core'
import {
  WHITE_MAX_DRIFT_M,
  WHITE_TRIANGLE_BUDGET,
  buildWhiteModel,
} from '../src/modules/assets/white-models.ts'

let dir: string

/** A 1.8 × 1.0 m table top of 80 000 triangles on a 0.9 m stand, plus a glass sheet. */
async function writeHeavyModel(file: string) {
  const document = new Document()
  const buffer = document.createBuffer()
  const n = 200
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) positions.push(-0.9 + (1.8 * i) / n, 0.9, -0.5 + (1.0 * j) / n)
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1)
    }
  }
  // Four legs reach the floor so the model's box spans 0 – 0.9 m.
  const legs: [number, number][] = [
    [-0.85, -0.45],
    [0.85, -0.45],
    [-0.85, 0.45],
    [0.85, 0.45],
  ]
  for (const [x, z] of legs) {
    const base = positions.length / 3
    positions.push(x, 0, z, x + 0.02, 0, z, x, 0.9, z)
    indices.push(base, base + 1, base + 2)
  }
  const texture = document
    .createTexture('photo')
    .setMimeType('image/png')
    .setImage(new Uint8Array([137, 80, 78, 71]))
  const wood = document
    .createMaterial('wood')
    .setBaseColorFactor([0.4, 0.3, 0.2, 1])
    .setBaseColorTexture(texture)
  const glassMaterial = document
    .createMaterial('glass')
    .setAlphaMode('BLEND')
    .setBaseColorFactor([0.8, 0.9, 1, 0.25])
  const top = document
    .createPrimitive()
    .setMaterial(wood)
    .setAttribute(
      'POSITION',
      document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(positions))
        .setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint32Array(indices))
        .setBuffer(buffer),
    )
  const sheet = document
    .createPrimitive()
    .setMaterial(glassMaterial)
    .setAttribute(
      'POSITION',
      document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array([-0.5, 0.95, 0, 0.5, 0.95, 0, 0, 1.2, 0]))
        .setBuffer(buffer),
    )
  const mesh = document.createMesh('table').addPrimitive(top).addPrimitive(sheet)
  document.createScene().addChild(document.createNode('table').setMesh(mesh))
  await new NodeIO().write(file, document)
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'white-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('buildWhiteModel', () => {
  it('simplifies to the budget, drops textures, keeps glass and the outer size', async () => {
    const source = path.join(dir, 'model.glb')
    const target = path.join(dir, 'white.glb')
    await writeHeavyModel(source)
    const record = await buildWhiteModel(source, target)

    expect(record.trianglesBefore).toBe(80_005)
    expect(record.trianglesAfter).toBeLessThanOrEqual(WHITE_TRIANGLE_BUDGET * 1.05)
    expect(record.driftM).toBeLessThanOrEqual(WHITE_MAX_DRIFT_M)
    expect(record.bytes).toBeLessThan(record.sourceBytes)

    const json = (await readFile(target)).subarray(20)
    const header = JSON.parse(
      json.subarray(0, (await readFile(target)).readUInt32LE(12)).toString(),
    ) as {
      materials: { name: string; alphaMode?: string }[]
      textures?: unknown[]
      extensionsUsed?: string[]
    }
    expect(header.textures ?? []).toEqual([])
    expect(header.materials.map((m) => m.name).sort()).toEqual(['white', 'white-glass'])
    expect(header.extensionsUsed).toContain('EXT_meshopt_compression')
  })
})
