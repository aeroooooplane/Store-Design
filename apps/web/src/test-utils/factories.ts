import type { Asset, DesignNode, NodeCamera, NodeSummary, Project } from '@store/shared'

/**
 * Test data with the fields every test file used to spell out. Defaults are the values the
 * files had in common; anything a test depends on is passed explicitly at the call site.
 */

export const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

/** A catalogue model: a placeable SI1.0 floor prop with no files attached. */
export function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: '1.8米普通中岛桌',
    standardName: '1.8米普通中岛桌',
    variant: '',
    materialCategory: '软装物料',
    siFamily: 'SI1.0',
    category: '软装道具',
    function: 'island_table',
    installation: 'floor',
    footprint: { w: 1, d: 1.8, h: 0.9 },
    footprintSource: 'glb',
    front: '+Z',
    staffSide: null,
    facingConfidence: 'high',
    placeable: true,
    retired: false,
    judgment: null,
    glb: null,
    whiteGlb: null,
    finishGlb: null,
    preview: null,
    productImage: null,
    productImageMatch: null,
    planSymbol: null,
    ...overrides,
  }
}

/** An active domestic SI1.0 side-hall project at revision 1. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: '南京德基',
    shopType: 'side_hall',
    market: 'domestic',
    siStyle: 'SI1.0',
    revision: 1,
    createdAt: '2026-10-09T02:00:00.000Z',
    updatedAt: '2026-10-09T02:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

/** A user-made tree node named after its id: a space at the root, a plan below it. */
export function makeNodeSummary(
  id: string,
  parentId: string | null,
  overrides: Partial<NodeSummary> = {},
): NodeSummary {
  return {
    id,
    parentId,
    kind: parentId === null ? 'space' : 'plan',
    name: id,
    strategy: null,
    siStyle: null,
    origin: 'user',
    importedFrom: null,
    hidden: false,
    createdAt: '2026-10-09T03:00:00.000Z',
    ...overrides,
  }
}

/** A full node as the API returns it, without a space or layout unless given. */
export function makeNode(
  id: string,
  parentId: string | null,
  overrides: Partial<DesignNode> = {},
): DesignNode {
  return {
    ...makeNodeSummary(id, parentId),
    projectId: PROJECT_ID,
    space: null,
    layout: null,
    ...overrides,
  }
}

/** Saved view `i` of a node, looking at the same target from x = `i`. */
export function makeCamera(
  i: number,
  nodeId: string,
  name: string,
  overrides: Partial<NodeCamera> = {},
): NodeCamera {
  return {
    id: `00000000-0000-4000-8000-00000000000${i}`,
    nodeId,
    sort: i,
    camera: { name, position: [i, 5, 9], target: [4, 0.8, 3], fovDeg: 48, source: 'auto' },
    deletedAt: null,
    ...overrides,
  }
}
