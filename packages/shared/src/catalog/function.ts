import type { ItemFunction } from '../enums.ts'

/**
 * Catalogue function from a model's standard name (or a label on a plan). Order matters:
 * specific phrases first (a 边桌收银柜 is a cashier, a 开箱储物柜 an unboxing table).
 */
export const FUNCTION_RULES: readonly [RegExp, ItemFunction][] = [
  [/收银/, 'cashier'],
  [/开箱/, 'unboxing_table'],
  [/中岛/, 'island_table'],
  [/配件边柜|边桌配件柜/, 'side_cabinet'],
  [/配件柜/, 'accessory_cabinet'],
  [/储物柜/, 'storage'],
  [/展示台|试飞台/, 'display_stand'],
  [/凳|沙发/, 'seating'],
  [/广告机|屏|水牌/, 'screen'],
  [/LOGO|画面|灯箱|侧招|标识/i, 'signage'],
]

export function functionFor(standardName: string): ItemFunction {
  return FUNCTION_RULES.find(([pattern]) => pattern.test(standardName))?.[1] ?? 'other'
}
