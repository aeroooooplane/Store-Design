import type { SiStyle } from '@store/shared'

/** Swaps the props of the step on screen to another SI style; says what it did, or null. */
export type SiSwitch = (style: SiStyle) => string | null
