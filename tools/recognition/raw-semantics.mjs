// 全页OCR只是读数；须找到对应长尺寸线并有不同尺寸互相支持，才给比例候选。
export function scaleCandidates(texts, lines) {
  const matches = []
  for (const [index, t] of texts.entries()) {
    if (!/^\d{4,5}$/.test(t.text.trim())) continue
    const mm = Number(t.text.trim())
    if (mm > 50000) continue
    const vertical = t.h > t.w * 1.5,
      cx = t.x + t.w / 2,
      cy = t.y + t.h / 2
    const nearby = lines
      .flatMap((l) => {
        const horizontal = Math.abs(l.y2 - l.y1) < 1
        if (horizontal === vertical) return []
        const a = horizontal ? Math.min(l.x1, l.x2) : Math.min(l.y1, l.y2)
        const b = horizontal ? Math.max(l.x1, l.x2) : Math.max(l.y1, l.y2)
        const at = horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
        const centre = horizontal ? cx : cy,
          perp = Math.abs(at - (horizontal ? cy : cx)),
          length = b - a
        if (
          length < 150 ||
          perp > 35 ||
          perp < 3 ||
          Math.abs(centre - (a + b) / 2) > Math.max(25, length * 0.08)
        )
          return []
        return [
          {
            index,
            mm,
            mmPerPixel: mm / length,
            line: l,
            score: perp + Math.abs(centre - (a + b) / 2),
            text: t.text,
          },
        ]
      })
      .sort((a, b) => a.score - b.score)
    if (nearby[0]) matches.push(nearby[0])
  }
  const groups = matches.map((seed) =>
    matches.filter((m) => Math.abs(m.mmPerPixel / seed.mmPerPixel - 1) <= 0.03),
  )
  const best = groups.sort((a, b) => b.length - a.length)[0] ?? []
  if (best.length < 2 || new Set(best.map((m) => m.mm)).size < 2) return []
  const sorted = best.map((m) => m.mmPerPixel).sort((a, b) => a - b),
    scale = sorted[Math.floor(sorted.length / 2)]
  // 相近支持量但不同尺度时不自动选择一套；整页可能含多个比例。
  if (
    groups.some(
      (g) =>
        g.length >= best.length - 1 && g.length >= 2 && Math.abs(g[0].mmPerPixel / scale - 1) > 0.1,
    )
  )
    return []
  return [
    {
      method: 'ocr-axis-line-consensus',
      mmPerPixel: scale,
      verified: false,
      readings: best,
      note: 'OCR数字与像素轴线的候选关系，未自动确认为真实尺度；需核对两端是否为尺寸界线。',
    },
  ]
}

export function heightCandidates(texts) {
  return texts.flatMap((t) => {
    if (/公区|室外|门头|LOGO|广告|柜|桌/.test(t.text)) return []
    const m =
      /(?:室内(?:完成面)?高(?:度)?|店铺现有吊顶高度|天花高度|层高)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|m|米)(?![²2])/i.exec(
        t.text,
      )
    if (!m) return []
    const metres = Number(m[1]) * (/^(mm|毫米)$/i.test(m[2]) ? 0.001 : 1)
    if (metres < 1.5 || metres > 20) return []
    return [
      { metres, sourceText: t.text, box: { x: t.x, y: t.y, w: t.w, h: t.h }, verified: false },
    ]
  })
}
