import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import type { AgentAction, AgentMessage } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useAiOverview } from '../settings/queries.ts'
import { exportPlan } from '../workbench/plan-export.ts'
import {
  useAgentMessages,
  useAgentSessions,
  useCreateSession,
  useSendMessage,
  useUndoAction,
} from './queries.ts'
import { AgentSelectionContext, useAgentSelection } from './selection.ts'

const TOOL_LABELS: Record<string, string> = {
  get_state: '查看状态',
  list_models: '查模型',
  generate_plans: '生成方案',
  place_item: '放置道具',
  move_item: '移动道具',
  rotate_item: '旋转道具',
  remove_item: '删除道具',
  validate: '检查布局',
  set_style: '切换风格',
  confirm_white: '进入三维效果',
  start_render: '创建渲染',
  export_project: '导出项目',
  edit_space: '修改空间',
  list_views: '查视角',
  add_view: '添加视角',
  remove_view: '删除视角',
}
/** Wide enough for the model to read labels, small enough to send quickly. */
const SCREENSHOT_WIDTH = 1600

/** Holds the plan selection for the dock; the plan editor reports into it. */
export function AgentSelectionProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([])
  const value = useMemo(() => ({ ids, set: setIds }), [ids])
  return <AgentSelectionContext.Provider value={value}>{children}</AgentSelectionContext.Provider>
}

/** The plan on screen as PNG for the model, or nothing when no plan is shown. */
async function planScreenshot(): Promise<string | undefined> {
  const svg = document.querySelector<SVGSVGElement>('svg.plan')
  if (!svg) return undefined
  try {
    return (await exportPlan(svg, SCREENSHOT_WIDTH)).png
  } catch {
    return undefined
  }
}

interface AgentDockProps {
  projectId: string
  /** The node on screen; the agent's changes start from it. */
  nodeId: string | null
  onSelect: (nodeId: string) => void
}

/** The design assistant, folded into a button at the bottom right until opened. */
export function AgentDock({ projectId, nodeId, onSelect }: AgentDockProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="agent-dock">
      {open ? (
        <AgentPanel
          projectId={projectId}
          nodeId={nodeId}
          onSelect={onSelect}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button type="button" className="primary agent-dock-toggle" onClick={() => setOpen(true)}>
          设计助理
        </button>
      )}
    </div>
  )
}

function AgentPanel({
  projectId,
  nodeId,
  onSelect,
  onClose,
}: AgentDockProps & { onClose: () => void }) {
  const overview = useAiOverview()
  const sessions = useAgentSessions(projectId)
  const create = useCreateSession(projectId)
  const [chosen, setChosen] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  // The newest conversation, unless the user picked another or started a new one.
  const sessionId = fresh ? null : (chosen ?? sessions.data?.[0]?.id ?? null)
  const messages = useAgentMessages(sessionId)
  const send = useSendMessage(projectId)
  const undo = useUndoAction(projectId)
  const selection = useAgentSelection()
  const [text, setText] = useState('')
  const [withPlan, setWithPlan] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.data, send.isPending])

  const agentModel = overview.data?.settings.agentModel ?? null
  // Only a vision model is shown the plan; the screenshot is kept with the message anyway.
  const canSee = overview.data?.models.find((m) => m.id === agentModel)?.vision ?? false
  const busy = send.isPending || create.isPending
  const canSend = Boolean(agentModel) && !busy && text.trim().length > 0

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed || busy || !agentModel) return
    let target = sessionId
    if (!target) {
      target = (await create.mutateAsync()).id
      setChosen(target)
      setFresh(false)
    }
    const planPng = withPlan && canSee ? await planScreenshot() : undefined
    const reply = await send.mutateAsync({
      sessionId: target,
      input: {
        text: trimmed,
        ...(nodeId ? { nodeId } : {}),
        ...(selection.ids.length ? { selectedItemIds: selection.ids } : {}),
        ...(planPng ? { planPng } : {}),
      },
    })
    setText('')
    if (reply.currentNodeId && reply.currentNodeId !== nodeId) onSelect(reply.currentNodeId)
  }
  const trySubmit = () => {
    submit().catch(() => {
      // Shown through the mutation's error below.
    })
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      trySubmit()
    }
  }

  const visible = (messages.data ?? []).filter((m) => m.role !== 'tool')
  return (
    <section className="agent-panel" aria-label="设计助理">
      <header className="agent-head">
        <h2>设计助理</h2>
        {sessions.data && sessions.data.length > 0 ? (
          <select
            aria-label="对话"
            value={sessionId ?? ''}
            onChange={(event) => {
              setChosen(event.target.value || null)
              setFresh(!event.target.value)
            }}
          >
            {fresh ? <option value="">新对话</option> : null}
            {sessions.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setChosen(null)
            setFresh(true)
          }}
          disabled={fresh || !sessionId}
        >
          新对话
        </button>
        <button type="button" onClick={onClose} aria-label="收起">
          ×
        </button>
      </header>
      <div className="agent-messages" ref={listRef}>
        {!agentModel && overview.data ? (
          <p className="hint">
            还没有可用的 Agent 模型，请先在 <Link to="/settings">设置</Link> 中配置模型密钥。
          </p>
        ) : null}
        {visible.length === 0 && !messages.isLoading ? (
          <p className="hint">
            告诉我要怎么改，例如“在后墙放一张中岛桌”“生成三个方案”“检查一下布局”。每次修改都会生成新的历史节点，可以撤销。
          </p>
        ) : null}
        {visible.map((m) => (
          <Message
            key={m.id}
            message={m}
            onSelect={onSelect}
            onUndo={sessionId ? (actionId) => undo.mutate({ sessionId, actionId }) : undefined}
            undoing={undo.isPending}
          />
        ))}
        {busy ? <p className="hint agent-busy">助理正在处理…</p> : null}
        <ErrorMessage error={send.error ?? create.error ?? undo.error ?? messages.error} />
      </div>
      <div className="agent-compose">
        <textarea
          aria-label="给设计助理的话"
          placeholder="例如：把收银台挪到右墙中间"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={!agentModel || busy}
        />
        <div className="agent-compose-row">
          <label className="hint">
            <input
              type="checkbox"
              checked={withPlan && canSee}
              disabled={!canSee}
              onChange={(event) => setWithPlan(event.target.checked)}
            />{' '}
            {canSee ? '附上当前平面截图' : '当前模型不能看图，不附截图'}
          </label>
          <button type="button" className="primary" onClick={trySubmit} disabled={!canSend}>
            发送
          </button>
        </div>
      </div>
    </section>
  )
}

function Message({
  message,
  onSelect,
  onUndo,
  undoing,
}: {
  message: AgentMessage
  onSelect: (nodeId: string) => void
  onUndo: ((actionId: string) => void) | undefined
  undoing: boolean
}) {
  const text = message.content.text
  return (
    <div className={`agent-msg ${message.role}`}>
      {text ? <div className="agent-text">{text}</div> : null}
      {message.actions.length ? (
        <ul className="agent-actions">
          {message.actions.map((a) => (
            <ActionRow
              key={a.id}
              action={a}
              onSelect={onSelect}
              onUndo={onUndo}
              undoing={undoing}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const asText = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)

/** A node the action made (several for generated plans), so it can be shown or undone. */
function madeNodes(action: AgentAction): string[] {
  const listed = action.result?.nodeIds
  if (Array.isArray(listed)) return listed.filter((id): id is string => typeof id === 'string')
  return action.resultingNodeId ? [action.resultingNodeId] : []
}

function ActionRow({
  action,
  onSelect,
  onUndo,
  undoing,
}: {
  action: AgentAction
  onSelect: (nodeId: string) => void
  onUndo: ((actionId: string) => void) | undefined
  undoing: boolean
}) {
  const label = TOOL_LABELS[action.toolName] ?? action.toolName
  const detail =
    action.status === 'failed'
      ? asText(action.result?.error, '失败')
      : asText(action.result?.done, '完成')
  const nodes = madeNodes(action)
  const undoable =
    nodes.length > 0 ||
    typeof action.result?.cameraId === 'string' ||
    typeof action.result?.restoreCameraId === 'string'
  return (
    <li className={`agent-action ${action.status}`}>
      <span>
        {label}：{detail}
      </span>
      {action.resultingNodeId && !action.undoneAt ? (
        <button
          type="button"
          className="link-button"
          onClick={() => onSelect(action.resultingNodeId ?? '')}
        >
          查看
        </button>
      ) : null}
      {undoable && !action.undoneAt && onUndo ? (
        <button
          type="button"
          className="link-button"
          onClick={() => onUndo(action.id)}
          disabled={undoing}
        >
          撤销
        </button>
      ) : null}
      {action.undoneAt ? <span className="undone">已撤销</span> : null}
    </li>
  )
}
