/**
 * The catalog service a sibling plugin reads: multiplier parsing, price
 * derivation from the base rate, and the live projection.
 */
import { describe, expect, it } from 'vitest'
import type { CatalogModel } from '../src/catalog.ts'
import {
  UNIT_CREDIT_PRICING,
  WORKBUDDY2API_CATALOG_SERVICE,
  WORKBUDDY2API_CATALOG_SERVICE_VERSION,
  createWorkBuddy2ApiCatalog,
  creditPriceOf,
  parseCreditsMultiplier,
  toCatalogModel,
} from '../src/catalog-service.ts'

function model(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: 'cn:deepseek-v4.1-flash',
    name: 'Deepseek-V4.1-Flash',
    region: 'cn',
    credits: 'x0.11',
    contextLength: 128000,
    maxOutputTokens: 8192,
    declaredEfforts: ['off', 'low', 'high'],
    efforts: ['off', 'low', 'high'],
    defaultEffort: 'high',
    canDisableThinking: true,
    supportsImages: false,
    supportsReasoning: true,
    onlyReasoning: false,
    tags: [],
    enabled: true,
    ...overrides,
  }
}

describe('parseCreditsMultiplier', () => {
  it('reads the gateway x-form and a bare number', () => {
    expect(parseCreditsMultiplier('x0.17')).toBe(0.17)
    expect(parseCreditsMultiplier('0.11')).toBe(0.11)
    expect(parseCreditsMultiplier('x0.00')).toBe(0)
    expect(parseCreditsMultiplier(' x0.79 ')).toBe(0.79)
  })

  it('treats missing and unparseable as unknown, not zero', () => {
    expect(parseCreditsMultiplier(undefined)).toBeUndefined()
    expect(parseCreditsMultiplier('')).toBeUndefined()
    expect(parseCreditsMultiplier('free')).toBeUndefined()
  })
})

describe('creditPriceOf', () => {
  it('scales every figure by the multiplier', () => {
    const price = creditPriceOf(0.11)
    expect(price).toEqual({
      cacheHit: UNIT_CREDIT_PRICING.cacheHit * 0.11,
      cacheMiss: UNIT_CREDIT_PRICING.cacheMiss * 0.11,
      output: UNIT_CREDIT_PRICING.output * 0.11,
    })
  })

  it('is undefined when the multiplier is unknown', () => {
    expect(creditPriceOf(undefined)).toBeUndefined()
  })
})

describe('toCatalogModel', () => {
  it('keeps the panel fields and adds a parsed, priced multiplier', () => {
    const projected = toCatalogModel(model())
    expect(projected.id).toBe('cn:deepseek-v4.1-flash')
    expect(projected.credits).toBe('x0.11')
    expect(projected.creditsMultiplier).toBe(0.11)
    expect(projected.price?.cacheMiss).toBeCloseTo(UNIT_CREDIT_PRICING.cacheMiss * 0.11)
    expect(projected.efforts).toEqual(['off', 'low', 'high'])
  })

  it('omits price when the model advertises no multiplier', () => {
    const projected = toCatalogModel(model({ credits: undefined }))
    expect(projected.creditsMultiplier).toBeUndefined()
    expect(projected.price).toBeUndefined()
  })
})

describe('createWorkBuddy2ApiCatalog', () => {
  it('exposes the live catalog, single lookups, revision and the base price', () => {
    let revision = 0
    const rows: CatalogModel[] = [model(), model({ id: 'global:deepseek-v4-pro', region: 'global', credits: 'x0.51' })]
    const service = createWorkBuddy2ApiCatalog(() => rows, () => revision)

    expect(service.serviceVersion).toBe(WORKBUDDY2API_CATALOG_SERVICE_VERSION)
    expect(WORKBUDDY2API_CATALOG_SERVICE).toBe('workbuddy2apiCatalog')
    expect(service.models().map(m => m.id)).toEqual(['cn:deepseek-v4.1-flash', 'global:deepseek-v4-pro'])
    expect(service.model('global:deepseek-v4-pro')?.creditsMultiplier).toBe(0.51)
    expect(service.model('nope')).toBeUndefined()
    expect(service.unitPricing()).toBe(UNIT_CREDIT_PRICING)

    revision = 1
    expect(service.revision()).toBe(1)
    // A source that grows is seen without rebuilding the service.
    rows.push(model({ id: 'cn:new-model', credits: 'x1.00' }))
    expect(service.models()).toHaveLength(3)
  })
})
