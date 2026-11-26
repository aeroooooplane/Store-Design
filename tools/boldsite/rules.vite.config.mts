import { fileURLToPath } from 'node:url'

export default {
  build: {
    lib: {
      entry: fileURLToPath(new URL('./rules.ts', import.meta.url)),
      name: 'WorkbenchDomain',
      formats: ['iife'],
      fileName: () => 'workbench-rules.js',
    },
    target: 'es2020',
    copyPublicDir: false,
  },
}
