import { Link } from 'react-router'
import type { AiModel, AiPurpose, AiSettings } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useAiOverview, useUpdateAiSettings } from './queries.ts'

const NONE = ''

function price(model: AiModel): string {
  if (!model.price) return '不收费'
  return `输入 ${model.price.inputCny} 元 / 输出 ${model.price.outputCny} 元（每百万 token）`
}

interface ChoiceProps {
  id: keyof AiSettings
  label: string
  hint: string
  models: AiModel[]
  value: string | null
  /** Shown when nothing fits (no key configured). */
  empty: string
  allowNone?: boolean
  disabled: boolean
  onChange: (value: string | null) => void
}

function Choice({
  id,
  label,
  hint,
  models,
  value,
  empty,
  allowNone,
  disabled,
  onChange,
}: ChoiceProps) {
  const chosen = models.find((m) => m.id === value)
  return (
    <div className="settings-row">
      <label htmlFor={id}>{label}</label>
      <div className="settings-control">
        {models.length === 0 && !allowNone ? (
          <p className="hint">{empty}</p>
        ) : (
          <select
            id={id}
            value={value ?? NONE}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === NONE ? null : e.target.value)}
          >
            {allowNone && <option value={NONE}>不使用</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <p className="hint">
          {hint}
          {chosen ? ` 当前：${price(chosen)}。` : ''}
        </p>
      </div>
    </div>
  )
}

const can = (purpose: AiPurpose) => (m: AiModel) => m.purposes.includes(purpose)

/**
 * Site-wide AI settings (per-user settings come with accounts): which model acts as the agent,
 * which reads uploaded plans, which takes over when local recognition fails; and today's budget.
 */
export function SettingsPage() {
  const overview = useAiOverview()
  const update = useUpdateAiSettings()
  const data = overview.data
  const models = data?.models ?? []
  const settings = data?.settings
  const budget = data?.budget
  const busy = update.isPending

  return (
    <main className="page settings-page">
      <header className="page-header">
        <h1>设置</h1>
        <Link to="/">← 项目列表</Link>
      </header>
      <ErrorMessage error={overview.error ?? update.error} />
      {!data && !overview.error && <p className="notice">正在加载…</p>}
      {data && settings && budget && (
        <>
          <section className="wb-card settings-section" aria-label="AI 模型">
            <h2>AI 模型</h2>
            <p className="hint">
              全站统一；密钥只保存在服务器的环境变量里（DEEPSEEK_API_KEY、DASHSCOPE_API_KEY），
              没有密钥的模型不会出现在列表中。境外模型须另行开启。
            </p>
            <Choice
              id="agentModel"
              label="Agent"
              hint="第三期的对话助手所用的模型。"
              models={models.filter(can('agent'))}
              value={settings.agentModel}
              empty="还没有可用的模型：请在服务器配置 DeepSeek 或通义千问的密钥。"
              disabled={busy}
              onChange={(v) => v && update.mutate({ agentModel: v })}
            />
            <Choice
              id="recognitionModel"
              label="平面识别"
              hint="上传简图时先用它识别。本地识别不收费。"
              models={models.filter(can('recognition'))}
              value={settings.recognitionModel}
              empty="本地识别不可用。"
              disabled={busy}
              onChange={(v) => v && update.mutate({ recognitionModel: v })}
            />
            <Choice
              id="recognitionFallback"
              label="识别失败后"
              hint="比例无法标定、边界不闭合或置信度低于 0.6 时改用它（需要能看图的联网模型）。"
              models={models.filter(
                (m) =>
                  m.id !== 'local' &&
                  m.vision &&
                  can('recognition')(m) &&
                  m.id !== settings.recognitionModel,
              )}
              value={settings.recognitionFallback}
              empty=""
              allowNone
              disabled={busy}
              onChange={(v) => update.mutate({ recognitionFallback: v })}
            />
            {update.isSuccess && (
              <p className="hint" role="status">
                已保存。
              </p>
            )}
          </section>

          <section className="wb-card settings-section" aria-label="今日额度">
            <h2>今日额度</h2>
            <p>
              {budget.day}（北京时间）：已用 {budget.spentCny.toFixed(2)} 元，剩余{' '}
              <strong>{budget.remainingCny.toFixed(2)}</strong> 元，共 {budget.limitCny} 元
              {budget.exceeded
                ? '。额度已用完，AI 功能暂停到明天 0 点；本地识别与自动排布照常可用。'
                : '。'}
            </p>
            <p className="hint">
              Agent 与平面识别共用；每次调用按模型报告的 token 数计费（单价为估算，见
              apps/api/src/ai/models.ts）。总额由服务器的 AI_DAILY_BUDGET_CNY 设定。
            </p>
          </section>
        </>
      )}
    </main>
  )
}
