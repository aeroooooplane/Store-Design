import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { MARKETS, MARKET_LABELS, SI_STYLES } from '@store/shared'
import type { DisplayTaskCreate } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { TrashIcon } from '../../components/icons.tsx'
import { formatDateTime } from '../../lib/format.ts'
import {
  useCreateDisplayTask,
  useDeleteDisplayTask,
  useDisplayRules,
  useDisplayTasks,
} from './queries.ts'

/**
 * Display tasks: display plans made from an uploaded store plan and render, without a project
 * (workflow 2). A project's own display plan is on its render stage.
 */
export function DisplayTasksPage() {
  const tasks = useDisplayTasks()
  const rules = useDisplayRules()
  const create = useCreateDisplayTask()
  const remove = useDeleteDisplayTask()
  const navigate = useNavigate()
  const [form, setForm] = useState<DisplayTaskCreate>({
    name: '',
    market: 'domestic',
    siStyle: 'SI2.0',
  })

  return (
    <main className="page">
      <header className="page-header">
        <h1>门店展陈方案</h1>
        <span className="page-header-end">
          <p>{rules.data ? `展陈规则 ${rules.data.version}` : '中岛桌 · 边桌 · 托盘'}</p>
        </span>
      </header>
      <ErrorMessage error={rules.error} />

      <form
        className="create-form display-create"
        onSubmit={(event) => {
          event.preventDefault()
          if (!form.name.trim()) return
          create.mutate(form, { onSuccess: (task) => void navigate(`/display/${task.id}`) })
        }}
      >
        <label>
          门店名称
          <input
            value={form.name}
            placeholder="如：影石-武汉荟聚边厅专卖店"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          市场
          <select
            value={form.market}
            onChange={(event) =>
              setForm({ ...form, market: event.target.value as DisplayTaskCreate['market'] })
            }
          >
            {MARKETS.map((m) => (
              <option key={m} value={m}>
                {MARKET_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          SI 版本
          <select
            value={form.siStyle}
            onChange={(event) =>
              setForm({ ...form, siStyle: event.target.value as DisplayTaskCreate['siStyle'] })
            }
          >
            {SI_STYLES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary" disabled={!form.name.trim() || create.isPending}>
          新建展陈方案
        </button>
      </form>
      <ErrorMessage error={create.error ?? remove.error ?? tasks.error} />
      <p className="hint">
        上传门店图纸（或平面图与效果图）生成展陈方案，不需要先建项目。系统内项目的展陈方案在其渲染阶段的“展陈”页签生成。
      </p>

      {tasks.data && tasks.data.length > 0 ? (
        <table className="projects">
          <thead>
            <tr>
              <th>门店</th>
              <th>市场</th>
              <th>SI</th>
              <th>桌子</th>
              <th>修改时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.data.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/display/${t.id}`}>{t.name}</Link>
                  {t.exported && <span className="tag">已生成</span>}
                </td>
                <td>{MARKET_LABELS[t.market]}</td>
                <td>{t.siStyle}</td>
                <td>{t.tables} 张</td>
                <td>{formatDateTime(t.updatedAt)}</td>
                <td className="actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`删除 ${t.name}`}
                    title="删除"
                    onClick={() => {
                      if (window.confirm(`删除展陈方案“${t.name}”？`)) remove.mutate(t.id)
                    }}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        tasks.data && <p className="notice">还没有展陈方案。</p>
      )}
    </main>
  )
}
