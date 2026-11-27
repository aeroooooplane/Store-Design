import {
  CubeUVReflectionMapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
} from 'three'
import textureUrl from './room-environment.bin.gz?url'

// Three.js RoomEnvironment rendered to its original 256 px PMREM cube faces with sigma 0.04.
// The atlas stores RGBA16F unchanged, with horizontal channel deltas in two byte planes.
const WIDTH = 768
const HEIGHT = 1024
const STRIDE = WIDTH * 4
const SIZE = STRIDE * HEIGHT

let cached: Promise<Uint16Array> | undefined

async function unpackEnvironment() {
  const response = await fetch(textureUrl)
  if (!response.ok) throw new Error('三维环境光纹理加载失败')
  const buffer = await response.arrayBuffer()
  const raw = new Uint8Array(buffer)
  const bytes =
    raw[0] === 0x1f && raw[1] === 0x8b
      ? new Uint8Array(
          await new Response(
            new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')),
          ).arrayBuffer(),
        )
      : raw
  if (bytes.byteLength !== SIZE * 2) throw new Error('三维环境光纹理尺寸不符')
  const pixels = new Uint16Array(SIZE)
  for (let row = 0; row < SIZE; row += STRIDE) {
    const end = row + STRIDE
    for (let i = row; i < row + 4; i++) pixels[i] = bytes[i]! | (bytes[SIZE + i]! << 8)
    for (let i = row + 4; i < end; i++)
      pixels[i] = (bytes[i]! | (bytes[SIZE + i]! << 8)) + pixels[i - 4]!
  }
  return pixels
}

export async function loadRoomEnvironment() {
  cached ??= unpackEnvironment().catch((error: unknown) => {
    cached = undefined
    throw error
  })
  const pixels = await cached
  // Each renderer owns its DataTexture; the uncompressed pixels are shared across viewers.
  const texture = new DataTexture(pixels, WIDTH, HEIGHT, RGBAFormat, HalfFloatType)
  texture.mapping = CubeUVReflectionMapping
  texture.colorSpace = LinearSRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}
