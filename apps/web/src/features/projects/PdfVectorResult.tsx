import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ITEM_SOURCE_LABELS, VectorContentSchema, polygonArea } from '@store/shared'
import type { RecognitionDraft } from '@store/shared'
import { checkDraft, failureReason } from '../../../../api/src/modules/recognition/check.ts'
import { recognizeVector } from '../../../../api/src/modules/recognition/local.ts'
import { extractVector } from '../recognition/pdf-extract.ts'

export async function recognizePdfPage(pdf: PDFDocumentProxy, page: number) {
  const vector = VectorContentSchema.safeParse(await extractVector(pdf, page))
  if (!vector.success) {
    throw new Error('本页的图纸元素过多或尺寸超出识别范围，请缩小图纸范围后再试。')
  }
  if (!vector.data.lines.length && !vector.data.rects.length) {
    throw new Error('本页没有可识别的矢量线条，请选择含矢量图形的 PDF 页。')
  }
  return checkDraft(recognizeVector(vector.data, {}, []))
}

export function PdfVectorResult({ result }: { result: RecognitionDraft }) {
  const failure = failureReason(result)

  return (
    <section aria-label="本页识别结果">
      <h3>本页识别结果</h3>
      <p role="status">
        {failure
          ? '需要复核 · ' + failure
          : '已提取轮廓 · ' + polygonArea(result.space?.boundary ?? []).toFixed(1) + ' ㎡'}
      </p>
      {result.scale && (
        <p>
          比例依据 {result.scale.reference} ·{' '}
          {result.scale.verified ? '尺寸交叉校验通过' : '比例待复核'}
        </p>
      )}
      {result.pending.length > 0 && (
        <ul aria-label="待复核事项">
          {result.pending.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
      {result.items.length > 0 && (
        <table className="projects" aria-label="识别道具">
          <thead>
            <tr>
              <th>标注</th>
              <th>位置</th>
              <th>识别备注</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => (
              <tr key={item.ref}>
                <td>{item.label}</td>
                <td>{ITEM_SOURCE_LABELS[item.source]}</td>
                <td>{item.note ?? '待复核'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">结果仅供本页核对，关闭项目后清除。</p>
    </section>
  )
}
