import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import { Link } from 'react-router'
import { AGENT_MAX_TEXT } from '@store/shared'
import type { AgentAction, AgentMessage, Asset } from '@store/shared'
import { BrandFace } from '../../components/BrandFace.tsx'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { ItemFunctionIcon } from '../../components/StoreIcons.tsx'
import { isFullWorkbench } from '../../api/deployment.ts'

import { useAiOverview } from '../settings/queries.ts'
import { exportPlan } from '../workbench/plan-export.ts'
import {
  useAgentMessages,
  useAgentSessions,
  useCreateSession,
  useSendMessage,
  useUndoAction,
} from './queries.ts'
import { AgentMarkdown } from './AgentMarkdown.tsx'
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

/** The catalogue loaded by the workbench, shared with the action records. */
const AgentCatalogContext = createContext<readonly Asset[]>([])

interface AgentDockProps {
  projectId: string
  /** The node on screen; the agent's changes start from it. */
  nodeId: string | null
  onSelect: (nodeId: string) => void
  /** The catalogue the workbench has already loaded, for the model names in action records. */
  assets?: readonly Asset[]
}

/** The design assistant, folded into a button at the bottom right until opened. */
export function AgentDock({ projectId, nodeId, onSelect, assets = [] }: AgentDockProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="agent-dock">
      {/* The catalogue is already loaded by the workbench; pass it down instead of fetching again. */}
      <AgentCatalogContext.Provider value={assets}>
        {open ? (
          <AgentPanel
            projectId={projectId}
            nodeId={nodeId}
            onSelect={onSelect}
            onClose={() => setOpen(false)}
          />
        ) : (
          <button type="button" className="primary agent-dock-toggle" onClick={() => setOpen(true)}>
            <BrandFace size={22} plate={false} />
            设计助理
          </button>
        )}
      </AgentCatalogContext.Provider>
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

  const following = useRef(true)
  const submitting = useRef(false)
  const [pending, setPending] = useState<{
    sessionId: string | null
    userId: string | null
    prompt: string
    reply: string
  } | null>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && following.current) list.scrollTop = list.scrollHeight
  }, [messages.data, pending, sessionId])

  function trackScroll() {
    const list = listRef.current
    if (list) following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24
  }

  const agentModel = overview.data?.settings.agentModel ?? null
  // Only a vision model is shown the plan; the screenshot is kept with the message anyway.
  const canSee = overview.data?.models.find((m) => m.id === agentModel)?.vision ?? false
  const busy = pending !== null
  const canSend = Boolean(agentModel) && !busy && text.trim().length > 0

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed || submitting.current || !agentModel) return
    submitting.current = true
    following.current = true
    send.reset()
    create.reset()
    setPending({ sessionId, userId: null, prompt: trimmed, reply: '' })
    setText('')
    let accepted = false
    try {
      let target = sessionId
      if (!target) {
        target = (await create.mutateAsync()).id
        setPending((current) => current && { ...current, sessionId: target })
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
        updates: {
          onUser: (userId) => {
            accepted = true
            setPending((current) => current && { ...current, userId })
          },
          onText: (delta) => {
            setPending((current) => current && { ...current, reply: current.reply + delta })
          },
        },
      })
      if (reply.currentNodeId && reply.currentNodeId !== nodeId) onSelect(reply.currentNodeId)
    } catch (error) {
      if (!accepted) setText(trimmed)
      throw error
    } finally {
      setPending(null)
      submitting.current = false
    }
  }
  const trySubmit = () => {
    submit().catch(() => {
      // Shown through the mutation's error below.
    })
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      trySubmit()
    }
  }

  const live = pending && pending.sessionId === sessionId ? pending : null
  const turns = groupTurns(messages.data ?? [])
  if (live && !turns.some((turn) => turn.id === live.userId)) {
    turns.push({ id: live.userId ?? 'sending', prompt: live.prompt, replies: [] })
  }
  const error = send.error ?? create.error ?? undo.error ?? messages.error
  return (
    <section className="agent-panel" aria-label="设计助理">
      <header className="agent-head">
        <BrandFace mood={send.error ? 'error' : 'idle'} />
        <h2>设计助理</h2>
        {sessions.data && sessions.data.length > 0 ? (
          <select
            aria-label="对话"
            value={sessionId ?? ''}
            disabled={busy}
            onChange={(event) => {
              following.current = true
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
            following.current = true
            setChosen(null)
            setFresh(true)
          }}
          disabled={busy || fresh || !sessionId}
        >
          新对话
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="收起"
          title="收起"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="agent-messages" ref={listRef} onScroll={trackScroll}>
        {!agentModel && overview.data ? (
          <p className="hint">
            {isFullWorkbench ? (
              '线上设计助理暂未接入模型服务，本轮不启用模型调用。'
            ) : (
              <>
                还没有可用的 Agent 模型，请先在 <Link to="/settings">设置</Link> 中配置模型密钥。
              </>
            )}
          </p>
        ) : null}
        {turns.length === 0 && !messages.isLoading ? (
          <p className="hint">
            告诉我要怎么改，例如“在后墙放一张中岛桌”“生成三个方案”“检查一下布局”。每次修改都会生成新的历史节点，可以撤销。
          </p>
        ) : null}
        {turns.map((turn, index) => {
          const active = live && turn.id === (live.userId ?? 'sending') ? live : null
          return (
            <div className="agent-turn" key={turn.id}>
              {turn.prompt !== null ? (
                <div className="agent-msg user agent-text agent-prompt">{turn.prompt}</div>
              ) : null}
              {active ? (
                active.reply ? (
                  <div className="agent-msg assistant" aria-busy="true">
                    <AgentMarkdown text={active.reply} streaming />
                  </div>
                ) : (
                  <p className="hint agent-busy" role="status">
                    <BrandFace mood="think" size={22} />
                    助理正在处理…
                  </p>
                )
              ) : (
                turn.replies.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    onSelect={onSelect}
                    onUndo={
                      sessionId ? (actionId) => undo.mutate({ sessionId, actionId }) : undefined
                    }
                    undoing={undo.isPending || busy}
                  />
                ))
              )}
              {index === turns.length - 1 ? <ErrorMessage error={error} /> : null}
            </div>
          )
        })}
        {turns.length === 0 ? <ErrorMessage error={error} /> : null}
      </div>
      <div className="agent-compose">
        <textarea
          aria-label="给设计助理的话"
          placeholder="例如：把收银台挪到右墙中间"
          value={text}
          maxLength={AGENT_MAX_TEXT}
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

function groupTurns(messages: AgentMessage[]) {
  const turns: { id: string; prompt: string | null; replies: AgentMessage[] }[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ id: message.id, prompt: message.content.text, replies: [] })
    } else if (message.role === 'assistant' && (message.content.text || message.actions.length)) {
      const turn = turns.at(-1)
      if (turn) turn.replies.push(message)
      else turns.push({ id: message.id, prompt: null, replies: [message] })
    }
  }
  return turns
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
    <div className="agent-msg assistant">
      {text ? <AgentMarkdown text={text} /> : null}
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
  // Actions on a prop (place, move, rotate, remove) name its model: show the category icon too.
  const catalog = useContext(AgentCatalogContext)
  const touched = action.result?.item as { modelId?: unknown; name?: unknown } | undefined
  const modelId = typeof touched?.modelId === 'string' ? touched.modelId : null
  const model = modelId ? catalog.find((a) => a.id === modelId) : undefined
  const nodes = madeNodes(action)
  const undoable =
    nodes.length > 0 ||
    typeof action.result?.cameraId === 'string' ||
    typeof action.result?.restoreCameraId === 'string'
  return (
    <li className={`agent-action ${action.status}`}>
      <span className="agent-action-text">
        {label}：
        {model ? (
          <ItemFunctionIcon fn={model.function} name={model.name} size={13} aria-hidden="true" />
        ) : null}
        {detail}
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
