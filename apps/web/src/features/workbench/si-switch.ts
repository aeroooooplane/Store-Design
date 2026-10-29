import type { SiStyle } from '@store/shared'

/** What the SI switch did: what to tell the user, and whether the step really changed. */
export interface SwitchResult {
  ok: boolean
  message: string | null
}

/** Switches the step on screen to another SI style; `ok: false` means nothing changed. */
export type SiSwitch = (style: SiStyle) => Promise<SwitchResult>
