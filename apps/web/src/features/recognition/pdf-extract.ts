import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { VectorContent } from '@store/shared'
import { extractPageVector } from './pdf-vector.ts'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Pages are rendered at this many pixels on the long side for upload and recognition. */
export const PAGE_LONG_SIDE_PX = 2400
const THUMB_LONG_SIDE_PX = 240

export interface PdfPage {
  number: number
  width: number
  height: number
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data }).promise
}

export async function listPages(doc: PDFDocumentProxy): Promise<PdfPage[]> {
  const pages: PdfPage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const { width, height } = page.getViewport({ scale: 1 })
    pages.push({ number: n, width, height })
  }
  return pages
}

function scaleFor(page: PDFPageProxy, longSidePx: number): number {
  const { width, height } = page.getViewport({ scale: 1 })
  return longSidePx / Math.max(width, height)
}

/** Draws a page to a canvas at the given long side; returns the canvas (PNG via toBlob). */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  longSidePx = PAGE_LONG_SIDE_PX,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: scaleFor(page, longSidePx) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法绘制页面')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, viewport }).promise
  return canvas
}

export const renderThumbnail = (doc: PDFDocumentProxy, pageNumber: number) =>
  renderPage(doc, pageNumber, THUMB_LONG_SIDE_PX)

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('无法生成 PNG'))), 'image/png')
  })
}

/** Text runs, lines and rectangles of a page, in pixels of the picture rendered at the same scale. */
export async function extractVector(
  doc: PDFDocumentProxy,
  pageNumber: number,
  longSidePx = PAGE_LONG_SIDE_PX,
): Promise<VectorContent> {
  const page = await doc.getPage(pageNumber)
  return extractPageVector(page, scaleFor(page, longSidePx), pdfjs.OPS)
}
