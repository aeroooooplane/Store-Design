/**
 * Shared set-up for the API tests: catalogue seeds, projects, node chains and request helpers.
 * Every helper that creates something through the API asserts the 201 it expects.
 */
import { expect } from 'vitest'
import { schema } from '@store/database'
import { LayoutSchema, rectangleSpace } from '@store/shared'
import type { Asset, DesignNode, NodeCameraList, NodeCreated, Project } from '@store/shared'
import { loadConfig } from '../src/config/env.ts'
import { systemContext } from '../src/context/actor.ts'
import { buildToolContext, findTool } from '../src/modules/agent/tools.ts'
import type { ToolOutcome } from '../src/modules/agent/tools.ts'
import { getProject } from '../src/modules/projects/service.ts'
import type { TestApp } from './helpers.ts'

// ---------------------------------------------------------------------------------------------
// Catalogue

export interface StoredFileSeed {
  storageKey: string
  kind?: string
  contentType?: string
  bytes?: number
  sha256?: string
}

/** One row of stored_files under the resource root; defaults describe a 1-byte GLB. */
export async function seedStoredFile(t: TestApp, seed: StoredFileSeed) {
  const [file] = await t.database.db
    .insert(schema.storedFiles)
    .values({
      root: 'resource',
      storageKey: seed.storageKey,
      kind: seed.kind ?? 'glb',
      contentType: seed.contentType ?? 'model/gltf-binary',
      bytes: seed.bytes ?? 1,
      sha256: seed.sha256 ?? 'a'.repeat(64),
    })
    .returning()
  if (!file) throw new Error(`stored file ${seed.storageKey} was not inserted`)
  return file
}

/** Shorthand for one catalogue model; every omitted field is the one of asset-1 below. */
export interface AssetSeed {
  id?: string
  name?: string
  variant?: string
  fn?: Asset['function']
  si?: string
  w?: number
  d?: number
  h?: number
  front?: string
  /**
   * Model file to point at. When the key is absent a fresh `models/<id>.glb` row is inserted;
   * when present (even as undefined) that value is used as is.
   */
  glbFileId?: string | undefined
}

/**
 * One placeable floor model of the 软装物料 category. By default the 1.0 × 1.8 m island table
 * asset-1 (1800mm普通中岛桌, SI1.0).
 */
export async function seedAsset(t: TestApp, seed: AssetSeed = {}) {
  const id = seed.id ?? 'asset-1'
  const glbFileId =
    'glbFileId' in seed
      ? seed.glbFileId
      : (await seedStoredFile(t, { storageKey: `models/${id}.glb` })).id
  await t.database.db.insert(schema.assets).values({
    id,
    standardName: seed.name ?? '1800mm普通中岛桌',
    variant: seed.variant ?? 'A',
    materialCategory: '软装物料',
    siFamily: seed.si ?? 'SI1.0',
    function: seed.fn ?? 'island_table',
    installation: 'floor',
    width: seed.w ?? 1,
    depth: seed.d ?? 1.8,
    height: seed.h ?? 1.327,
    footprintSource: 'glb',
    front: seed.front ?? 'any',
    placeable: true,
    glbFileId,
  })
}

// ---------------------------------------------------------------------------------------------
// Requests

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * `inject` with URLs relative to /api/v1. Takes a getter because the app is usually created
 * in beforeAll, after the module-level helper is defined.
 */
export function api(app: () => TestApp) {
  return (method: Method, url: string, payload?: object) =>
    app().app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) })
}

/** POST /projects with the body as given; expects 201. */
export async function createProject(t: TestApp, body: Record<string, unknown>): Promise<Project> {
  const response = await t.app.inject({ method: 'POST', url: '/api/v1/projects', payload: body })
  expect(response.statusCode).toBe(201)
  return response.json<Project>()
}

/** POST /projects/:id/nodes without any expectation. */
export function postNode(t: TestApp, projectId: string, payload: object) {
  return t.app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/nodes`, payload })
}

/** POST /projects/:id/nodes; expects 201 and returns the created node. */
export async function createNode(t: TestApp, projectId: string, payload: object) {
  const response = await postNode(t, projectId, payload)
  expect(response.statusCode).toBe(201)
  return response.json<NodeCreated>().node
}

/** A root space node named 空间; by default an 8 × 6 × 3.2 m room entered along z = 6. */
export function createSpace(
  t: TestApp,
  projectId: string,
  space: object = rectangleSpace(8, 6, 3.2),
) {
  return createNode(t, projectId, { parentId: null, kind: 'space', name: '空间', space })
}

/**
 * A step of the old 'edit' kind, written straight to the table as an import does: the API no
 * longer creates them, but old projects still have them.
 */
export async function seedLegacyEdit(
  t: TestApp,
  projectId: string,
  parentId: string,
  name: string,
  layout: object,
): Promise<DesignNode> {
  const [row] = await t.database.db
    .insert(schema.designNodes)
    .values({
      projectId,
      parentId,
      kind: 'edit',
      name,
      layout: LayoutSchema.parse(layout),
      origin: 'user',
    })
    .returning({ id: schema.designNodes.id })
  return getNode(t, row?.id)
}

/** GET /nodes/:id; expects 200. */
export async function getNode(t: TestApp, id: string | undefined): Promise<DesignNode> {
  const response = await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${id}` })
  expect(response.statusCode).toBe(200)
  return response.json<DesignNode>()
}

// ---------------------------------------------------------------------------------------------
// Layouts and stage chains

/** A layout item of the asset-1 island table. */
export const islandItem = (id: string, cx: number, cz: number, extra: object = {}) => ({
  id,
  assetId: 'asset-1',
  function: 'island_table',
  name: `中岛桌 ${id}`,
  cx,
  cz,
  rotation: 0,
  w: 1,
  d: 1.8,
  h: 1.327,
  ...extra,
})

export const layoutOf = (...items: object[]) => ({ schemaVersion: 3, items })

/** A placeholder table needs no catalogue model. */
export const placeholderLayout = {
  schemaVersion: 3,
  items: [
    {
      id: 'island_table-1',
      assetId: null,
      function: 'island_table',
      name: '中岛桌',
      cx: 4,
      cz: 3,
      rotation: 0,
      w: 1.8,
      d: 0.9,
      h: 0.9,
      placeholder: true,
    },
  ],
}

export interface ChainOptions {
  projectName: string
  planName?: string
}

/**
 * A side-hall project with space → plan → white, all on the placeholder layout. The space is
 * 8 × 6 × 3.2 m with its main entrance drawn from (8, 6) to (0, 6).
 */
export async function whiteChain(t: TestApp, { projectName, planName = '方案' }: ChainOptions) {
  const project = await createProject(t, { name: projectName, shopType: 'side_hall' })
  const space = await createSpace(t, project.id, {
    ...rectangleSpace(8, 6, 3.2),
    entrances: [{ a: [8, 6], b: [0, 6], kind: 'main' }],
  })
  const layout = placeholderLayout
  const plan = await createNode(t, project.id, {
    parentId: space.id,
    kind: 'plan',
    name: planName,
    layout,
  })
  const white = await createNode(t, project.id, {
    parentId: plan.id,
    kind: 'white',
    name: '白模',
    layout,
  })
  return { project, space, plan, white }
}

/** whiteChain plus an SI1.0 render node under the white model, and that node's views. */
export async function renderChain(t: TestApp, options: ChainOptions) {
  const chain = await whiteChain(t, options)
  const render = await createNode(t, chain.project.id, {
    parentId: chain.white.id,
    kind: 'render',
    name: '渲染',
    siStyle: 'SI1.0',
    layout: placeholderLayout,
  })
  const cameras = (
    await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${render.id}/cameras` })
  ).json<NodeCameraList>().cameras
  return { ...chain, render, cameras }
}

// ---------------------------------------------------------------------------------------------
// Design assistant tools

const toolConfig = loadConfig({ NODE_ENV: 'test' })

export type ToolCall = [
  projectId: string,
  nodeId: string | null,
  name: string,
  input?: object,
  selectedItemIds?: string[],
]

/** Runs one tool the way the agent service does: fresh context, input parsed by its schema. */
export async function runTool(
  t: TestApp,
  ...[projectId, nodeId, name, input = {}, selectedItemIds = []]: ToolCall
): Promise<ToolOutcome> {
  const tool = findTool(name)
  if (!tool) throw new Error(`no tool ${name}`)
  const ctx = systemContext('test')
  const project = await getProject(t.database.db, ctx, projectId)
  const tools = await buildToolContext(
    t.database.db,
    ctx,
    toolConfig,
    project,
    nodeId,
    selectedItemIds,
  )
  return tool.run(tools, tool.schema.parse(input))
}
