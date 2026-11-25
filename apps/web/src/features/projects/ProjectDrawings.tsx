import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { RecognitionDraft } from '@store/shared'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PlanUploadSchema, UPLOAD_MAX_BYTES } from '@store/shared'
import { api, unwrap } from '../../api/client.ts'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { recognitionKeys, useUploadPlan } from '../recognition/queries.ts'

const PdfVectorResult = lazy(async () => ({
  default: (await import('./PdfVectorResult.tsx')).PdfVectorResult,
}))

export function ProjectDrawings({ projectId }: { projectId: string }) {
  const upload = useUploadPlan(projectId)
  const drawings = useQuery({
    queryKey: recognitionKeys.uploads(projectId),
    queryFn: async () =>
      PlanUploadSchema.array().parse(
        unwrap(
          await api.GET('/api/v1/projects/{projectId}/uploads', {
            params: { path: { projectId } },
          }),
        ),
      ),
  })
  const [pdf, setPdf] = useState<{ document: PDFDocumentProxy; name: string } | null>(null)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<RecognitionDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    return () => {
      if (pdf) void pdf.document.destroy()
    }
  }, [pdf])

  async function run(action: () => Promise<void>) {
    setError(null)
    upload.reset()
    setBusy(true)
    try {
      await action()
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  function choose(file: File) {
    setPdf(null)
    setResult(null)
    setPage(1)
    return run(async () => {
      const contentType = file.type
      if (contentType === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const { openPdf } = await import('../recognition/pdf-extract.ts')
        setPdf({ document: await openPdf(await file.arrayBuffer()), name: file.name })
      } else if (contentType === 'image/png' || contentType === 'image/jpeg') {
        if (file.size > UPLOAD_MAX_BYTES) throw new Error('请选择 20 MB 以内的图片')
        await upload.mutateAsync({ blob: file, contentType, originalName: file.name })
      } else {
        throw new Error('请选择 PNG、JPG 或 PDF 图纸')
      }
    })
  }

  return (
    <section className="wb-card" aria-label="项目图纸">
      <h2>图纸</h2>
      <div className="toolbar">
        <label>
          上传图纸
          <input
            type="file"
            accept=".pdf,image/png,image/jpeg"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void choose(file)
            }}
          />
        </label>
        {busy && <span role="status">正在处理图纸…</span>}
      </div>
      {pdf && (
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              const { canvasToPng, renderPage } = await import('../recognition/pdf-extract.ts')
              const blob = await canvasToPng(await renderPage(pdf.document, page))
              if (blob.size > UPLOAD_MAX_BYTES) throw new Error('转换后的图片超过 20 MB')
              await upload.mutateAsync({
                blob,
                contentType: 'image/png',
                originalName: pdf.name,
                page,
              })
            })
          }}
        >
          <label>
            PDF 页码（共 {pdf.document.numPages} 页）
            <input
              type="number"
              min={1}
              max={pdf.document.numPages}
              required
              value={page || ''}
              onChange={(event) => {
                setPage(event.target.valueAsNumber)
                setResult(null)
                setError(null)
              }}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy}>
            上传本页
          </button>
          <button
            type="button"
            disabled={busy || !Number.isInteger(page) || page < 1 || page > pdf.document.numPages}
            onClick={() => {
              setResult(null)
              void run(async () => {
                const { recognizePdfPage } = await import('./PdfVectorResult.tsx')
                setResult(await recognizePdfPage(pdf.document, page))
              })
            }}
          >
            识别本页矢量
          </button>
        </form>
      )}
      {result && (
        <Suspense fallback={<p role="status">正在加载识别结果…</p>}>
          <PdfVectorResult result={result} />
        </Suspense>
      )}
      <ErrorMessage error={error ?? drawings.error} />
      {drawings.isPending && <p role="status">正在读取图纸…</p>}
      {drawings.data?.length === 0 && <p>还没有上传图纸。</p>}
      {!!drawings.data?.length && (
        <ul>
          {drawings.data.map((drawing) => (
            <li key={drawing.id}>
              <a href={drawing.url} download>
                下载 {drawing.originalName ?? '图纸'}
                {drawing.page !== null && `（第 ${drawing.page} 页，PNG）`}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
