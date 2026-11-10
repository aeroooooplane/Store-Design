import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { BackgroundImage, NodeCameraList, RenderBackground } from '@store/shared'
import { RenderBackgroundSchema } from '@store/shared'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'
import { api, renderChain } from './fixtures.ts'
import { cameraSignature } from '../src/modules/renders/service.ts'

let t: TestApp
let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'render-background-'))
  t = await createTestApp({ STORAGE_ROOT: dir })
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})
const inject = api(() => t)

it('上传后按版本保存、重载、撤销移除，旧渲染上传不能冒充新背景', async () => {
  const { render } = await renderChain(t, { projectName: '背景版本测试' })
  const cameras = (await inject('GET', `/nodes/${render.id}/cameras`)).json<NodeCameraList>()
    .cameras
  const camera = cameras[0]!
  const upload = await t.app.inject({
    method: 'POST',
    url: `/api/v1/cameras/${camera.id}/background-image`,
    headers: { 'content-type': 'image/png' },
    payload: png(300, 200),
  })
  expect(upload.statusCode).toBe(201)
  const image = upload.json<BackgroundImage>()
  expect(image).toMatchObject({ width: 300, height: 200 })
  const background: RenderBackground = {
    image,
    transform: { x: 0.5, y: 0.5, width: 1, rotationDeg: 0 },
    masks: [],
    guides: [],
    guidesVisible: true,
    showTransparentWalls: false,
    showFloor: false,
    modelOpacity: 0.45,
  }
  const saved = await inject('PATCH', `/cameras/${camera.id}`, {
    background,
    expectedBackgroundRevision: 0,
  })
  expect(saved.statusCode).toBe(200)
  expect(saved.json().camera).toMatchObject({
    background,
    backgroundRevision: 1,
    source: camera.camera.source,
  })
  expect(
    (
      await inject('PATCH', `/cameras/${camera.id}`, {
        background: null,
        expectedBackgroundRevision: 0,
      })
    ).statusCode,
  ).toBe(409)
  expect(
    (await inject('GET', `/nodes/${render.id}/cameras`)).json().cameras[0].camera.background,
  ).toEqual(background)
  const renderUpload = (revision?: number) =>
    t.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${render.id}/renders/${camera.id}/material${revision === undefined ? '' : `?backgroundRevision=${revision}`}`,
      headers: { 'content-type': 'image/png' },
      payload: png(1800, 1200),
    })
  expect((await renderUpload()).statusCode).toBe(409)
  expect((await renderUpload(1)).statusCode).toBe(201)
  const removed = await inject('PATCH', `/cameras/${camera.id}`, {
    background: null,
    expectedBackgroundRevision: 1,
  })
  expect(removed.statusCode).toBe(200)
  expect(removed.json().camera.backgroundRevision).toBe(2)
  expect((await renderUpload(1)).statusCode).toBe(409)
  expect((await renderUpload(2)).statusCode).toBe(201)
  expect(
    (await inject('PATCH', `/cameras/${camera.id}`, { background, expectedBackgroundRevision: 2 }))
      .statusCode,
  ).toBe(200)
})

it('非法图、伪造尺寸、其他项目文件和自交遮罩不能保存', async () => {
  const { render } = await renderChain(t, { projectName: '背景校验测试' })
  const camera = (await inject('GET', `/nodes/${render.id}/cameras`)).json<NodeCameraList>()
    .cameras[0]!
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${camera.id}/background-image`,
        headers: { 'content-type': 'image/png' },
        payload: Buffer.from('invalid'),
      })
    ).statusCode,
  ).toBe(400)
  const upload = await t.app.inject({
    method: 'POST',
    url: `/api/v1/cameras/${camera.id}/background-image`,
    headers: { 'content-type': 'image/png' },
    payload: png(100, 100),
  })
  const image = upload.json<BackgroundImage>()
  const background: RenderBackground = {
    image,
    transform: { x: 0.5, y: 0.5, width: 1, rotationDeg: 0 },
    masks: [],
    guides: [],
    guidesVisible: true,
    showTransparentWalls: false,
  }
  expect(
    (
      await inject('PATCH', `/cameras/${camera.id}`, {
        background: { ...background, image: { ...image, width: 101 } },
        expectedBackgroundRevision: 0,
      })
    ).statusCode,
  ).toBe(400)
  const other = await renderChain(t, { projectName: '另一个背景项目' })
  const otherCamera = (
    await inject('GET', `/nodes/${other.render.id}/cameras`)
  ).json<NodeCameraList>().cameras[0]!
  expect(
    (
      await inject('PATCH', `/cameras/${otherCamera.id}`, {
        background,
        expectedBackgroundRevision: 0,
      })
    ).statusCode,
  ).toBe(400)
  expect(
    RenderBackgroundSchema.safeParse({
      ...background,
      masks: [
        {
          id: 'bad',
          points: [
            [0, 0],
            [1, 1],
            [0, 1],
            [1, 0],
          ],
        },
      ],
    }).success,
  ).toBe(false)
})

it('辅助线显隐不改变渲染签名，照片、遮罩与墙显隐改变签名', () => {
  const camera = {
    name: '视角',
    position: [1, 2, 3] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fovDeg: 45,
    source: 'auto' as const,
  }
  const background: RenderBackground = {
    image: {
      fileId: '00000000-0000-4000-8000-000000000001',
      url: '/api/v1/files/00000000-0000-4000-8000-000000000001',
      width: 100,
      height: 100,
      name: '图',
    },
    transform: { x: 0.5, y: 0.5, width: 1, rotationDeg: 0 },
    masks: [],
    guides: [],
    guidesVisible: true,
    showTransparentWalls: false,
  }
  const signature = cameraSignature({ ...camera, background })
  expect(
    cameraSignature({ ...camera, background: { ...background, showFloor: true, modelOpacity: 1 } }),
  ).toBe(signature)
  expect(cameraSignature({ ...camera, background: { ...background, showFloor: false } })).not.toBe(
    signature,
  )
  expect(cameraSignature({ ...camera, background: { ...background, modelOpacity: 0 } })).not.toBe(
    signature,
  )
  expect(cameraSignature({ ...camera, background: { ...background, modelOpacity: 0.5 } })).not.toBe(
    signature,
  )
  expect(RenderBackgroundSchema.safeParse({ ...background, modelOpacity: -0.01 }).success).toBe(
    false,
  )
  expect(RenderBackgroundSchema.safeParse({ ...background, modelOpacity: 1.01 }).success).toBe(
    false,
  )
  expect(
    cameraSignature({
      ...camera,
      background: {
        ...background,
        guidesVisible: false,
        guides: [
          {
            id: 'g',
            points: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
      },
    }),
  ).toBe(signature)
  expect(
    cameraSignature({ ...camera, background: { ...background, showTransparentWalls: true } }),
  ).not.toBe(signature)
  expect(
    cameraSignature({
      ...camera,
      background: {
        ...background,
        masks: [
          {
            id: 'm',
            points: [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          },
        ],
      },
    }),
  ).not.toBe(signature)
  expect(cameraSignature({ ...camera, background: null })).toBe(cameraSignature(camera))
})
