import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fullPdf as renderFull, showPdf as renderShow } from './pdf-template.ts'
import type { DeliveryContent, PdfResult as TemplateResult } from './pdf-template.ts'

export type { DeliveryContent, DeliveryView } from './pdf-template.ts'
export type PdfResult = Omit<TemplateResult, 'data'> & { data: Buffer }

/** Bundled CJK font (Noto Sans SC, SIL OFL), cut to GB2312 + symbols; see assets/fonts. */
const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts')
const fonts = {
  regular: path.join(FONT_DIR, 'NotoSansSC-Regular.ttf'),
  bold: path.join(FONT_DIR, 'NotoSansSC-Bold.ttf'),
}

export async function fullPdf(content: DeliveryContent): Promise<PdfResult> {
  const result = await renderFull(content, fonts)
  return { ...result, data: Buffer.from(result.data) }
}

export async function showPdf(content: DeliveryContent): Promise<PdfResult> {
  const result = await renderShow(content, fonts)
  return { ...result, data: Buffer.from(result.data) }
}
