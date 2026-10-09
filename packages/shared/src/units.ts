// Storage unit is metres with millimetre precision; the UI shows millimetres.

export const EPSILON_M = 0.001

export function roundM(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function mmToM(mm: number): number {
  return roundM(mm / 1000)
}

export function mToMm(m: number): number {
  return Math.round(m * 1000)
}
