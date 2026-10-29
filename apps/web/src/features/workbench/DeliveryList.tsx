import type { Delivery } from '@store/shared'
import { Download, FileText, Presentation } from 'lucide-react'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'

interface DeliveryListProps {
  deliveries: Delivery[]
  error: unknown
}

const sizeText = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

/** Earlier deliveries of this render node; each keeps its two PDFs and the folder ZIP. */
export function DeliveryList({ deliveries, error }: DeliveryListProps) {
  return (
    <section className="wb-card delivery-list" aria-label="交付文件">
      <h3>交付文件（{deliveries.length}）</h3>
      <ErrorMessage error={error} />
      {deliveries.length === 0 ? (
        <div className="delivery-empty">
          <FileText size={24} aria-hidden="true" />
          <strong>尚无交付文件</strong>
          <p className="hint">
            生成后这里列出每次交付：完整版 PDF、展示版 PDF 和交付目录
            ZIP（同时写入服务器归档目录）。
          </p>
        </div>
      ) : (
        <ol>
          {deliveries.map((d) => (
            <li key={d.id}>
              <span className="delivery-name" title={d.archivePath ?? '未写入归档目录'}>
                {d.folderName}
              </span>
              <span className="hint">
                {new Date(d.createdAt).toLocaleString('zh-CN', { hour12: false })} · {d.views}{' '}
                个视角
              </span>
              <span className="delivery-links">
                <a href={d.fullPdf.url} target="_blank" rel="noreferrer">
                  <FileText size={16} aria-hidden="true" />
                  完整版 PDF（{d.pages.full} 页）
                </a>
                <a href={d.showPdf.url} target="_blank" rel="noreferrer">
                  <FileText size={16} aria-hidden="true" />
                  展示版 PDF（{d.pages.show} 页）
                </a>
                {d.displayPpt && (
                  <a href={d.displayPpt.url} download={d.displayPpt.name}>
                    <Presentation size={16} aria-hidden="true" />
                    展陈方案 PPT
                  </a>
                )}
                <a
                  className="button primary delivery-download"
                  href={d.zip.url}
                  download={d.zip.name}
                >
                  <Download size={16} aria-hidden="true" />
                  下载 ZIP（{sizeText(d.zip.bytes)}）
                </a>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
