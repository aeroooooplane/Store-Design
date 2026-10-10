import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { MARKET_LABELS, SHOP_TYPE_LABELS } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { TrashIcon } from '../../components/icons.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { CreateProjectForm } from './CreateProjectForm.tsx'
import { PAGE_SIZE, useProjectList, useSetProjectDeleted } from './queries.ts'
import type { ProjectListParams } from './queries.ts'

const STATUS_TABS: { value: ProjectListParams['status']; label: string }[] = [
  { value: 'active', label: '项目' },
  { value: 'deleted', label: '回收站' },
]

export function ProjectListPage() {
  const [status, setStatus] = useState<ProjectListParams['status']>('active')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDeferredValue(search)
  const list = useProjectList({ q, status, page })
  const setDeleted = useSetProjectDeleted()

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="page">
      <header className="page-header">
        <h1>门店空间设计工作台</h1>
        <p>SI1.0 / SI2.0 · 平面 · 白模 · 效果</p>
      </header>

      <CreateProjectForm />

      <div className="toolbar">
        <div className="tabs" role="group" aria-label="项目状态">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={status === tab.value}
              onClick={() => {
                setStatus(tab.value)
                setPage(1)
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="按名称搜索"
          placeholder="按名称搜索"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>

      <ErrorMessage error={list.error ?? setDeleted.error} />

      {list.isPending ? (
        <p className="notice">正在加载…</p>
      ) : list.data && list.data.items.length === 0 ? (
        <p className="notice">
          {status === 'active' ? '还没有项目，先在上方新建一个。' : '回收站是空的。'}
        </p>
      ) : list.data ? (
        <table className="projects">
          <thead>
            <tr>
              <th>项目名称</th>
              <th>铺位形态</th>
              <th>市场</th>
              <th>SI 风格</th>
              <th>更新时间</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((project) => (
              <tr key={project.id}>
                <td>{project.name}</td>
                <td>{SHOP_TYPE_LABELS[project.shopType]}</td>
                <td>{MARKET_LABELS[project.market]}</td>
                <td>{project.siStyle}</td>
                <td>{formatDateTime(project.updatedAt)}</td>
                <td className="actions">
                  {project.deletedAt === null ? (
                    <>
                      <Link className="button primary" to={`/projects/${project.id}`}>
                        打开
                      </Link>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="移入回收站"
                        title="移入回收站"
                        disabled={setDeleted.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `确定把「${project.name}」移入回收站吗？之后可在“回收站”中恢复。`,
                            )
                          ) {
                            setDeleted.mutate({ project, deleted: true })
                          }
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={setDeleted.isPending}
                      onClick={() => setDeleted.mutate({ project, deleted: false })}
                    >
                      恢复
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {pages > 1 ? (
        <nav className="pager" aria-label="分页">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>
            第 {page} / {pages} 页，共 {total} 个
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </nav>
      ) : null}
    </main>
  )
}
