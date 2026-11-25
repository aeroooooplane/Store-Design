import { fullPdf, showPdf } from '../../../../api/src/modules/deliveries/pdf-template.ts'
import type { DeliveryContent } from '../../../../api/src/modules/deliveries/pdf-template.ts'
import boldUrl from '../../../../api/assets/fonts/NotoSansSC-Bold.ttf?url'
import regularUrl from '../../../../api/assets/fonts/NotoSansSC-Regular.ttf?url'

async function loadFont(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('中文出图字体加载失败')
  return response.arrayBuffer()
}

export async function exportDeliveryPdfs(content: DeliveryContent) {
  const [regular, bold] = await Promise.all([loadFont(regularUrl), loadFont(boldUrl)])
  const fonts = { regular, bold }
  const [full, show] = await Promise.all([fullPdf(content, fonts), showPdf(content, fonts)])
  return {
    full: new Blob([full.data], { type: 'application/pdf' }),
    show: new Blob([show.data], { type: 'application/pdf' }),
  }
}
