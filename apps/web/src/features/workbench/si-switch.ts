import type { SiStyle } from '@store/shared'

/** Switches the step on screen to another SI style; says what it did, or null (nothing to do here). */
export type SiSwitch = (style: SiStyle) => Promise<string | null>
