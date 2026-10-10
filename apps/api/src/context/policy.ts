import type { Actor } from './actor.ts'

export type Action =
  | 'project:list'
  | 'project:read'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'project:restore'
  | 'project:import'
  | 'project:export'
  | 'node:read'
  | 'node:create'
  | 'node:update'
  | 'draft:read'
  | 'draft:write'
  | 'camera:read'
  | 'camera:write'
  | 'layout:generate'
  | 'layout:validate'
  | 'asset:read'
  | 'file:read'

export interface ResourceRef {
  projectId?: string
}

/**
 * Single authorisation point. Everything is public until the account system arrives; then
 * this checks project ownership and throws `AppError('FORBIDDEN', …)`. Services must call it
 * before reading or changing data so that no route can bypass the future check.
 */
export function authorize(_actor: Actor, _action: Action, _resource?: ResourceRef): void {
  // Public data during development: every actor may perform every action.
}
