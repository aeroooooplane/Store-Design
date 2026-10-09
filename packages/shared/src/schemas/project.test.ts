import { describe, expect, it } from 'vitest'
import { ProjectCreateSchema, ProjectListQuerySchema, ProjectUpdateSchema } from './project.ts'

describe('ProjectCreateSchema', () => {
  it('defaults to the domestic market and SI1.0 and trims the name', () => {
    expect(ProjectCreateSchema.parse({ name: '  上海星光店 ', shopType: 'side_hall' })).toEqual({
      name: '上海星光店',
      shopType: 'side_hall',
      market: 'domestic',
      siStyle: 'SI1.0',
    })
  })

  it('rejects blank names, unknown shop types and unknown fields', () => {
    expect(ProjectCreateSchema.safeParse({ name: '   ', shopType: 'island' }).success).toBe(false)
    expect(ProjectCreateSchema.safeParse({ name: 'A', shopType: 'flagship' }).success).toBe(false)
    expect(
      ProjectCreateSchema.safeParse({ name: 'A', shopType: 'zone', userId: 'x' }).success,
    ).toBe(false)
  })
})

describe('ProjectUpdateSchema', () => {
  it('requires at least one field', () => {
    expect(ProjectUpdateSchema.safeParse({}).success).toBe(false)
    expect(ProjectUpdateSchema.safeParse({ siStyle: 'SI2.0' }).success).toBe(true)
  })
})

describe('ProjectListQuerySchema', () => {
  it('coerces query-string numbers and applies defaults', () => {
    expect(ProjectListQuerySchema.parse({ page: '2' })).toEqual({
      status: 'active',
      page: 2,
      pageSize: 20,
    })
    expect(ProjectListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false)
  })
})
