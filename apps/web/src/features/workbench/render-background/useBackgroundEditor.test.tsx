import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RenderBackground } from '@store/shared'
import { makeCamera } from '../../../test-utils/factories.ts'
import { renderWithClient } from '../../../test-utils/render.tsx'
import { useBackgroundEditor } from './useBackgroundEditor.ts'

const api = vi.hoisted(() => ({ upload: vi.fn(), save: vi.fn() }))
vi.mock('../api.ts', () => ({
  uploadBackgroundImage: api.upload,
  saveCameraBackground: api.save,
  workbenchKeys: {
    cameras: (id: string) => ['cameras', id],
    renders: (id: string) => ['renders', id],
  },
}))
const camera = makeCamera(0, 'node', '正面')
const cameras = [camera]
function Probe() {
  const editor = useBackgroundEditor('node', cameras)
  return (
    <button
      onClick={() => {
        editor.upload(camera.id, new File(['a'], 'first.png', { type: 'image/png' }))
        editor.upload(camera.id, new File(['b'], 'second.png', { type: 'image/png' }))
      }}
    >
      同次上传
    </button>
  )
}
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
it('locks each view synchronously so two uploads in one event cannot race', async () => {
  let finish!: (value: unknown) => void
  api.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  api.save.mockImplementation(
    async (_id: string, background: RenderBackground | null, revision: number) => ({
      ...camera,
      camera: { ...camera.camera, background, backgroundRevision: revision + 1 },
    }),
  )
  renderWithClient(<Probe />)
  fireEvent.click(screen.getByText('同次上传'))
  expect(api.upload).toHaveBeenCalledTimes(1)
  finish({
    fileId: '99999999-9999-4999-8999-999999999999',
    url: '/api/v1/files/99999999-9999-4999-8999-999999999999',
    name: 'first.png',
    width: 1200,
    height: 800,
  })
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
  expect(api.save.mock.calls[0]?.[1].image.name).toBe('first.png')
  fireEvent.click(screen.getByText('同次上传'))
  expect(api.upload).toHaveBeenCalledTimes(2)
})
