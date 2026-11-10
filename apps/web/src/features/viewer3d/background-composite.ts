import type { BackgroundPoint, RenderBackground } from '@store/shared'

export const SCENE_BACKGROUND = '#e8eaed'

/** Converts a point in the original photo (0…1) to the target frame's pixel coordinates. */
export function backgroundPhotoMatrix(
  background: RenderBackground,
  width: number,
  height: number,
): DOMMatrix {
  const { transform, image } = background
  const photoWidth = transform.width * width
  const photoHeight = (photoWidth * image.height) / image.width
  return new DOMMatrix()
    .translateSelf(transform.x * width, transform.y * height)
    .rotateSelf(transform.rotationDeg)
    .scaleSelf(photoWidth, photoHeight)
    .translateSelf(-0.5, -0.5)
}

function maskPath(background: RenderBackground, matrix: DOMMatrix): Path2D {
  const path = new Path2D()
  for (const { points } of background.masks) {
    if (points.length < 3) continue
    const area = points.reduce((sum, [x, y], i) => {
      const next = points[(i + 1) % points.length]!
      return sum + x * next[1] - y * next[0]
    }, 0)
    // Nonzero clipping makes the union only if all simple polygons have the same winding.
    const ordered = area < 0 ? [...points].reverse() : points
    ordered.forEach(([x, y]: BackgroundPoint, i) => {
      const p = matrix.transformPoint({ x, y })
      if (i === 0) path.moveTo(p.x, p.y)
      else path.lineTo(p.x, p.y)
    })
    path.closePath()
  }
  return path
}

/** The photo sits behind the transparent 3D frame, except at the photo's foreground masks. */
export function drawBackgroundComposition(
  context: CanvasRenderingContext2D,
  background: RenderBackground,
  photo: CanvasImageSource,
  modelLayer: CanvasImageSource,
): void {
  const { width, height } = context.canvas
  const matrix = backgroundPhotoMatrix(background, width, height)
  context.save()
  try {
    context.resetTransform()
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = SCENE_BACKGROUND
    context.clearRect(0, 0, width, height)
    context.drawImage(modelLayer, 0, 0, width, height)

    if (background.masks.length) {
      // Erase just the 3D layer, so the mask edge leaves unchanged photo pixels untouched.
      context.globalCompositeOperation = 'destination-out'
      context.fill(maskPath(background, matrix))
    }

    context.globalCompositeOperation = 'destination-over'
    context.setTransform(matrix)
    context.drawImage(photo, 0, 0, 1, 1)
    context.resetTransform()
    context.fillRect(0, 0, width, height)
  } finally {
    context.restore()
  }
}

export async function loadBackgroundPhoto(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = url
  try {
    await image.decode()
    return image
  } catch {
    throw new Error('背景图片无法加载，请检查图片后重试')
  }
}
