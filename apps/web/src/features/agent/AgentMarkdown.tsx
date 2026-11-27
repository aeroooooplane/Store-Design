import { memo } from 'react'
import type { ReactNode } from 'react'

/** The formats used by the assistant. Everything else is left as React text. */
function inline(text: string, streaming: boolean): ReactNode[] {
  const tokens =
    /\\([\\*_"`])|`([^`]+)`|\*\*(\S(?:.*?\S)?)\*\*|__(\S(?:.*?\S)?)__|\*(\S(?:.*?\S)?)\*|_(\S(?:.*?\S)?)_/g
  const nodes: ReactNode[] = []
  let end = 0
  for (const match of text.matchAll(tokens)) {
    const [token, escaped, code, boldStar, boldLine, italicStar, italicLine] = match
    nodes.push(text.slice(end, match.index))
    if (escaped) nodes.push(escaped)
    else if (code) nodes.push(<code key={match.index}>{code}</code>)
    else if (boldStar ?? boldLine)
      nodes.push(<strong key={match.index}>{inline(boldStar ?? boldLine ?? '', false)}</strong>)
    else if (italicStar ?? italicLine)
      nodes.push(<em key={match.index}>{inline(italicStar ?? italicLine ?? '', false)}</em>)
    end = match.index + token.length
  }
  const tail = text.slice(end)
  if (streaming) {
    const open = /(?<!\\)(\*\*|__|`|\*|_)(\S.*?)?$/.exec(tail)
    if (open) {
      const [, marker, value = ''] = open
      nodes.push(tail.slice(0, open.index))
      const visible = value.replace(/[*_`]+$/, '')
      if (marker === '`') nodes.push(<code key={end}>{visible}</code>)
      else if (marker?.length === 2) nodes.push(<strong key={end}>{visible}</strong>)
      else nodes.push(<em key={end}>{visible}</em>)
      return nodes
    }
  }
  nodes.push(tail)
  return nodes
}

const item = /^\s*(?:([-+*])|(\d{1,9})[.)])\s+(.+)$/
const heading = /^\s{0,3}(#{1,6})\s+(.+)$/
const fence = /^\s{0,3}```[^`]*$/

export const AgentMarkdown = memo(function AgentMarkdown({
  text,
  streaming = false,
}: {
  text: string
  streaming?: boolean
}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  const final = (line: number) => streaming && line === lines.length - 1
  for (let index = 0; index < lines.length;) {
    const start = index
    const line = lines[index++] ?? ''
    if (!line.trim()) continue
    if (final(start) && /^\s*(?:#{1,6}|[-+*]|\d+[.)]|`{1,2})$/.test(line)) break

    if (fence.test(line)) {
      const code: string[] = []
      while (index < lines.length && !fence.test(lines[index] ?? ''))
        code.push(lines[index++] ?? '')
      if (index < lines.length) index++
      blocks.push(
        <pre key={start}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const title = heading.exec(line)
    if (title?.[1] && title[2]) {
      const level = Math.min(title[1].length + 2, 6)
      const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[level - 3] ?? 'h6'
      blocks.push(<Tag key={start}>{inline(title[2], final(start))}</Tag>)
      continue
    }

    const firstItem = item.exec(line)
    if (firstItem) {
      const ordered = firstItem[2] !== undefined
      const items = [<li key={start}>{inline(firstItem[3] ?? '', final(start))}</li>]
      for (; index < lines.length; index++) {
        const entry = item.exec(lines[index] ?? '')
        if (!entry || (entry[2] !== undefined) !== ordered) break
        items.push(<li key={index}>{inline(entry[3] ?? '', final(index))}</li>)
      }
      blocks.push(
        ordered ? (
          <ol key={start} start={Number(firstItem[2])}>
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      )
      continue
    }

    const paragraph = [line]
    for (; index < lines.length; index++) {
      const next = lines[index] ?? ''
      if (!next.trim() || heading.test(next) || item.test(next) || fence.test(next)) break
      paragraph.push(next)
    }
    blocks.push(
      <p key={start}>
        {paragraph.map((lineText, offset) => (
          <span key={offset}>
            {offset > 0 ? <br /> : null}
            {inline(lineText, final(start + offset))}
          </span>
        ))}
      </p>,
    )
  }
  return <div className="agent-markdown">{blocks}</div>
})
