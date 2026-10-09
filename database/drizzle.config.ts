import { defineConfig } from 'drizzle-kit'

// Generates SQL migrations from the schema; no database connection is needed for `generate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
})
