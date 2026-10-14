import { createHash } from 'node:crypto'
import { asc, desc, eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type {
  AgentAction,
  AgentContent,
  AgentMessage,
  AgentReply,
  AgentSend,
  AgentSession,
} from '@store/shared'
import { chat } from '../../ai/chat.ts'
import type { ChatMessage, ToolCall } from '../../ai/chat.ts'
import { findModel } from '../../ai/models.ts'
import { readSettings } from '../../ai/settings.ts'
import type { AppConfig } from '../../config/env.ts'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { setCameraDeleted } from '../cameras/service.ts'
import { fileUrl } from '../../lib/file-url.ts'
import { registerStoredFile, writeStorageFile } from '../../lib/stored-files.ts'
import { requireActiveProject, setHidden } from '../nodes/service.ts'
import { getProject } from '../projects/service.ts'
import { buildToolContext, findTool, refreshNode, stateSummary, toolSpecs } from './tools.ts'
import type { ToolContext } from './tools.ts'

const { agentActions, agentMessages, agentSessions } = schema
type SessionRow = typeof agentSessions.$inferSelect
type MessageRow = typeof agentMessages.$inferSelect
type ActionRow = typeof agentActions.$inferSelect

/** Tool rounds for one user message; past this the model is asked to wrap up. */
const MAX_ROUNDS = 8
/** Earlier turns replayed to the model (user and assistant text only). */
const HISTORY_TURNS = 20
const DEFAULT_TITLE = '新对话'
const MAX_SESSIONS = 100

const SYSTEM_PROMPT = `你是门店空间设计工作台的设计助理，帮设计师在当前项目里排布道具。
规则：
- 只能通过提供的工具查看和修改项目；不要凭空编造坐标、尺寸或模型编号。
- 所有长度单位为毫米；道具位置以中心点表示，x 向右、z 向下，旋转为 0/90/180/270。
- 每次修改都会生成一个新的历史节点，用户可以撤销；连续修改会在上一次修改的结果上继续。
- 空间的 edges 是边表：eN 为顶点 N 到 N+1 的边，依次是长度、走向（0° 为 +x，90° 为 +z）、所属墙（从入口看：back 后墙，front 入口一侧，left/right 左右墙；斜向为斜墙），以及入口、开放边。
- 放置道具优先使用 along/position 贴墙描述，让程序按真实的边计算坐标；需要精确位置时用 move_item 的相对偏移。放不下时工具会报错，按提示换位置或换墙。
- 修改后如果检查结果有问题，告诉用户问题是什么，并提出解决办法。
- 用简体中文简洁回答，说明做了什么、结果如何；不要输出 JSON。
- 用户没有明确要求修改时，只回答问题，不要改动布局。`

function toSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toAction(row: ActionRow): AgentAction {
  return {
    id: row.id,
    messageId: row.messageId,
    toolName: row.toolName,
    input: row.input,
    result: row.result ?? null,
    status: row.status as AgentAction['status'],
    resultingNodeId: row.resultingNodeId,
    undoneAt: row.undoneAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function toMessage(row: MessageRow, actions: ActionRow[]): AgentMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as AgentMessage['role'],
    content: row.content as AgentContent,
    imageUrl: row.imageFileId ? fileUrl(row.imageFileId) : null,
    model: row.model,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costCny: row.costCny,
    createdAt: row.createdAt.toISOString(),
    actions: actions.map(toAction),
  }
}

async function findSession(db: Database, sessionId: string): Promise<SessionRow> {
  const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId))
  if (!row) throw notFound('对话')
  return row
}

export async function createSession(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  input: { title?: string },
): Promise<AgentSession> {
  authorize(ctx.actor, 'agent:write', { projectId })
  await requireActiveProject(db, projectId)
  const [row] = await db
    .insert(agentSessions)
    .values({ projectId, title: input.title ?? DEFAULT_TITLE })
    .returning()
  if (!row) throw new Error('Session insert returned no row')
  return toSession(row)
}

export async function listSessions(
  db: Database,
  ctx: RequestContext,
  projectId: string,
): Promise<AgentSession[]> {
  authorize(ctx.actor, 'agent:read', { projectId })
  const rows = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.projectId, projectId))
    .orderBy(desc(agentSessions.updatedAt))
    .limit(MAX_SESSIONS)
  return rows.map(toSession)
}

async function messagesOf(db: Database, sessionId: string): Promise<AgentMessage[]> {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id))
  const actions = rows.length
    ? await db
        .select({ action: agentActions })
        .from(agentActions)
        .innerJoin(agentMessages, eq(agentMessages.id, agentActions.messageId))
        .where(eq(agentMessages.sessionId, sessionId))
        .orderBy(asc(agentActions.createdAt))
    : []
  return rows.map((row) =>
    toMessage(
      row,
      actions.filter((a) => a.action.messageId === row.id).map((a) => a.action),
    ),
  )
}

export async function listMessages(
  db: Database,
  ctx: RequestContext,
  sessionId: string,
): Promise<AgentMessage[]> {
  const session = await findSession(db, sessionId)
  authorize(ctx.actor, 'agent:read', { projectId: session.projectId })
  return messagesOf(db, sessionId)
}

/** The plan picture sent with a message, kept like an upload. */
async function storeImage(
  db: Database,
  roots: StorageRoots,
  projectId: string,
  base64: string,
): Promise<string> {
  const data = Buffer.from(base64, 'base64')
  if (data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) {
    throw new AppError('VALIDATION_FAILED', '平面截图必须是 PNG')
  }
  const sha256 = createHash('sha256').update(data).digest('hex')
  const storageKey = `agent/${projectId}/${sha256.slice(0, 16)}.png`
  await writeStorageFile(roots, storageKey, data)
  return registerStoredFile(db, {
    storageKey,
    kind: 'agent_image',
    contentType: 'image/png',
    bytes: data.length,
    sha256,
    originalName: null,
  })
}

/** Earlier turns as the model sees them: just what was said, not the tool traffic. */
function replayHistory(messages: AgentMessage[]): ChatMessage[] {
  const spoken = messages.filter((m) => m.role !== 'tool' && m.content.text.trim())
  return spoken.slice(-HISTORY_TURNS).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content.text,
  }))
}

async function insertMessage(
  db: Database,
  sessionId: string,
  role: AgentMessage['role'],
  content: AgentContent,
  extra: Partial<{
    imageFileId: string
    model: string
    tokensIn: number
    tokensOut: number
    costCny: number
  }> = {},
): Promise<{ id: string }> {
  const [row] = await db
    .insert(agentMessages)
    .values({ sessionId, role, content, ...extra })
    .returning({ id: agentMessages.id })
  if (!row) throw new Error('Message insert returned no row')
  return row
}

/** Runs one tool call, records it, and returns what the model is told. */
async function runTool(
  db: Database,
  tools: ToolContext,
  messageId: string,
  call: ToolCall,
): Promise<{ content: string; nodeId?: string }> {
  const tool = findTool(call.name)
  let result: Record<string, unknown>
  let status: AgentAction['status'] = 'succeeded'
  let nodeId: string | undefined
  if (!tool) {
    result = { error: `没有工具 ${call.name}` }
    status = 'failed'
  } else {
    const parsed = tool.schema.safeParse(call.arguments)
    if (!parsed.success) {
      result = { error: `参数不正确：${parsed.error.issues.map((i) => i.message).join('；')}` }
      status = 'failed'
    } else {
      try {
        const outcome = await tool.run(tools, parsed.data)
        result = outcome.result
        nodeId = outcome.nodeId
      } catch (error) {
        // Expected failures (a bad state, an unknown model) are the model's to work around.
        if (!(error instanceof AppError)) throw error
        result = { error: error.message }
        status = 'failed'
      }
    }
  }
  await db.insert(agentActions).values({
    messageId,
    toolName: call.name,
    input: call.arguments,
    result,
    status,
    resultingNodeId: nodeId ?? null,
  })
  if (nodeId) await refreshNode(tools, nodeId)
  return { content: JSON.stringify(result), ...(nodeId ? { nodeId } : {}) }
}

/**
 * One turn of the conversation: the user's message is kept, the model answers with tools
 * (each change becoming a node), and the final answer comes back with where the project
 * now stands. A failed model call still keeps the user's message.
 */
export async function sendMessage(
  db: Database,
  ctx: RequestContext,
  config: AppConfig,
  roots: StorageRoots,
  sessionId: string,
  input: AgentSend,
): Promise<AgentReply> {
  const session = await findSession(db, sessionId)
  authorize(ctx.actor, 'agent:write', { projectId: session.projectId })
  await requireActiveProject(db, session.projectId)
  const project = await getProject(db, ctx, session.projectId)
  const settings = await readSettings(db, config.ai)
  if (!settings.agentModel) {
    throw new AppError('VALIDATION_FAILED', '还没有可用的 Agent 模型，请先在设置中配置模型密钥')
  }
  // The screenshot is kept with the message either way; only a vision model is shown it.
  const picture = findModel(settings.agentModel)?.vision ? input.planPng : undefined
  const tools = await buildToolContext(
    db,
    ctx,
    config,
    project,
    input.nodeId ?? null,
    input.selectedItemIds ?? [],
  )

  const history = await messagesOf(db, sessionId)
  const imageFileId = input.planPng
    ? await storeImage(db, roots, project.id, input.planPng)
    : undefined
  const userContent: AgentContent = {
    text: input.text,
    nodeId: input.nodeId ?? null,
    ...(input.selectedItemIds?.length ? { selectedItemIds: input.selectedItemIds } : {}),
  }
  const userMessage = await insertMessage(db, sessionId, 'user', userContent, {
    ...(imageFileId ? { imageFileId } : {}),
  })
  if (session.title === DEFAULT_TITLE && history.length === 0) {
    await db
      .update(agentSessions)
      .set({ title: input.text.slice(0, 30) })
      .where(eq(agentSessions.id, sessionId))
  }

  const conversation: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `当前项目状态（JSON）：\n${JSON.stringify(stateSummary(tools))}`,
    },
    ...replayHistory(history),
    {
      role: 'user',
      content: picture ? `${input.text}\n（附上了当前平面截图）` : input.text,
      ...(picture ? { images: [{ mediaType: 'image/png' as const, base64: picture }] } : {}),
    },
  ]

  let currentNodeId: string | null = tools.node?.id ?? null
  let replyId: string | null = null
  for (let round = 0; ; round++) {
    const wrapUp = round >= MAX_ROUNDS
    const result = await chat(db, config, {
      purpose: 'agent',
      modelId: settings.agentModel,
      messages: wrapUp
        ? [
            ...conversation,
            { role: 'system', content: '工具调用次数已达上限，请直接总结目前的结果。' },
          ]
        : conversation,
      ...(wrapUp ? {} : { tools: toolSpecs }),
      ref: { type: 'agent_session', id: sessionId },
    })
    const toolCalls = wrapUp ? [] : result.toolCalls
    const assistant = await insertMessage(
      db,
      sessionId,
      'assistant',
      { text: result.text, ...(toolCalls.length ? { toolCalls } : {}) },
      {
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costCny: result.costCny,
      },
    )
    replyId = assistant.id
    if (!toolCalls.length) break
    conversation.push({ role: 'assistant', content: result.text, toolCalls })
    for (const call of toolCalls) {
      const outcome = await runTool(db, tools, assistant.id, call)
      if (outcome.nodeId) currentNodeId = outcome.nodeId
      await insertMessage(db, sessionId, 'tool', {
        text: outcome.content,
        toolCallId: call.id,
        toolName: call.name,
      })
      conversation.push({ role: 'tool', content: outcome.content, toolCallId: call.id })
    }
  }

  await db
    .update(agentSessions)
    .set({ updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId))
  const all = await messagesOf(db, sessionId)
  const stored = all.find((m) => m.id === userMessage.id)
  const reply = all.find((m) => m.id === replyId)
  if (!stored || !reply) throw new Error('Conversation rows missing after insert')
  return { userMessage: stored, reply, currentNodeId }
}

/**
 * Undoes an action: hides the node(s) it made, deletes a view it added or restores one it
 * removed. A read-only or already undone action cannot be undone.
 *
 * One transaction: the action row is locked while the "already undone" check runs, and either
 * every node / view is reverted and the action marked undone, or nothing changes.
 */
export async function undoAction(
  db: Database,
  ctx: RequestContext,
  actionId: string,
): Promise<AgentAction> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ action: agentActions, projectId: agentSessions.projectId })
      .from(agentActions)
      .innerJoin(agentMessages, eq(agentMessages.id, agentActions.messageId))
      .innerJoin(agentSessions, eq(agentSessions.id, agentMessages.sessionId))
      .where(eq(agentActions.id, actionId))
      .for('update', { of: agentActions })
    if (!found) throw notFound('操作')
    authorize(ctx.actor, 'agent:write', { projectId: found.projectId })
    const action = found.action
    if (action.undoneAt) throw new AppError('INVALID_STATE', '该操作已撤销')
    const listed = action.result?.nodeIds
    const nodeIds = Array.isArray(listed)
      ? listed.filter((id): id is string => typeof id === 'string')
      : action.resultingNodeId
        ? [action.resultingNodeId]
        : []
    const cameraId = typeof action.result?.cameraId === 'string' ? action.result.cameraId : null
    const restoreId =
      typeof action.result?.restoreCameraId === 'string' ? action.result.restoreCameraId : null
    if (nodeIds.length) {
      for (const nodeId of nodeIds) await setHidden(tx, ctx, nodeId, true)
    } else if (cameraId) {
      await setCameraDeleted(tx, ctx, cameraId, true)
    } else if (restoreId) {
      await setCameraDeleted(tx, ctx, restoreId, false)
    } else {
      throw new AppError('INVALID_STATE', '该操作没有产生可撤销的改动')
    }
    const [updated] = await tx
      .update(agentActions)
      .set({ undoneAt: new Date() })
      .where(eq(agentActions.id, actionId))
      .returning()
    if (!updated) throw notFound('操作')
    return toAction(updated)
  })
}
