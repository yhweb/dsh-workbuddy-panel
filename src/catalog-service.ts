/**
 * The catalog service this plugin provides on `ctx`.
 *
 * The panel is the source of truth for the live model catalog, but a sibling
 * plugin that only wants "which models exist and what each costs" previously
 * had to reach into this package's internals or duplicate the derivation. This
 * module publishes the same catalog as a Cordis service
 * (`ctx.get('workbuddy2apiCatalog')`) so another plugin can read models and
 * their credit prices without importing the panel, the gateway client, or any
 * Node built-in.
 *
 * Prices are expressed in WorkBuddy credits (积分), the unit the gateway itself
 * bills in. The base rate — credits per million tokens at a x1.0 multiplier —
 * was reverse-engineered from the gateway's own usage ledger; every model's
 * price is that base scaled by the `xN` multiplier the gateway advertises.
 *
 * @module dsh-workbuddy-panel/catalog-service
 */

import type { CatalogModel } from './catalog.ts'

/** The Cordis service name this plugin provides. */
export const WORKBUDDY2API_CATALOG_SERVICE = 'workbuddy2apiCatalog'

/** The contract generation consumers should compare against. */
export const WORKBUDDY2API_CATALOG_SERVICE_VERSION = 1

/**
 * Base unit price: credits per million tokens at a x1.0 multiplier.
 *
 * Reverse-engineered from the gateway's usage ledger (the true per-request
 * credit cost), so a consumer that multiplies by a model's multiplier lands on
 * the number the gateway actually charges. Kept here, not in the ledger config,
 * because this is the one place the panel can state it without depending on
 * cost-meter's storage.
 */
export const UNIT_CREDIT_PRICING = {
  /** The unit the numbers are in. */
  currency: 'credits',
  /** All three figures are per one million tokens. */
  unit: 'per-million-tokens',
  /** The multiplier this base corresponds to. */
  multiplier: 1,
  /** Cached (cache-hit) input tokens. */
  cacheHit: 2.5972727273,
  /** Uncached (cache-miss) input tokens. */
  cacheMiss: 129.9227273,
  /** Output tokens. */
  output: 519.4290909,
} as const

/** The base unit price shape. */
export type UnitCreditPricing = typeof UNIT_CREDIT_PRICING

/** Credits per million tokens for one model. */
export interface CreditPrice {
  cacheHit: number
  cacheMiss: number
  output: number
}

/** One model as the catalog service exposes it: the panel row plus its price. */
export interface WorkBuddyCatalogModel {
  id: string
  name: string
  region: 'cn' | 'global'
  description?: string
  vendor?: string
  /** The multiplier text the gateway advertises, e.g. `x0.17`. */
  credits?: string
  /** The parsed multiplier, when the text carries a number. */
  creditsMultiplier?: number
  contextLength: number
  maxOutputTokens: number
  efforts: readonly string[]
  defaultEffort?: string
  enabled: boolean
  canDisableThinking: boolean
  supportsImages: boolean
  supportsReasoning: boolean
  onlyReasoning: boolean
  tags: readonly string[]
  /** Credits per million tokens; absent when the model advertises no multiplier. */
  price?: CreditPrice
}

/** The service value consumers read. */
export interface WorkBuddy2ApiCatalog {
  /** Contract generation; compare against {@link WORKBUDDY2API_CATALOG_SERVICE_VERSION}. */
  readonly serviceVersion: number
  /** Monotonic revision; bumps on every catalog change so a consumer can skip unchanged reads. */
  revision(): number
  /** The live catalog, priced. A fresh snapshot on each call. */
  models(): readonly WorkBuddyCatalogModel[]
  /** One model by id, or undefined when the gateway does not list it. */
  model(id: string): WorkBuddyCatalogModel | undefined
  /** The base unit price (multiplier 1) every model's price is derived from. */
  unitPricing(): UnitCreditPricing
}

/**
 * Parse a gateway multiplier like `x0.17` into its number.
 *
 * Accepts a bare number too (`0.17`), since the gateway has answered both
 * shapes. A missing or unparseable value is `undefined` — "no price known" is
 * different from "price zero".
 */
export function parseCreditsMultiplier(credits: string | undefined): number | undefined {
  if (credits === undefined) return undefined
  const match = /^[xX]?\s*([0-9]+(?:\.[0-9]+)?)$/u.exec(credits.trim())
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** Price one model from its multiplier; undefined when the multiplier is unknown. */
export function creditPriceOf(multiplier: number | undefined): CreditPrice | undefined {
  if (multiplier === undefined) return undefined
  return {
    cacheHit: UNIT_CREDIT_PRICING.cacheHit * multiplier,
    cacheMiss: UNIT_CREDIT_PRICING.cacheMiss * multiplier,
    output: UNIT_CREDIT_PRICING.output * multiplier,
  }
}

/** Project one panel catalog row onto the service shape, adding the price. */
export function toCatalogModel(model: CatalogModel): WorkBuddyCatalogModel {
  const creditsMultiplier = parseCreditsMultiplier(model.credits)
  const price = creditPriceOf(creditsMultiplier)
  return {
    id: model.id,
    name: model.name,
    region: model.region,
    ...model.description === undefined ? {} : { description: model.description },
    ...model.vendor === undefined ? {} : { vendor: model.vendor },
    ...model.credits === undefined ? {} : { credits: model.credits },
    ...creditsMultiplier === undefined ? {} : { creditsMultiplier },
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    efforts: model.efforts,
    ...model.defaultEffort === undefined ? {} : { defaultEffort: model.defaultEffort },
    enabled: model.enabled,
    canDisableThinking: model.canDisableThinking,
    supportsImages: model.supportsImages,
    supportsReasoning: model.supportsReasoning,
    onlyReasoning: model.onlyReasoning,
    tags: model.tags,
    ...price === undefined ? {} : { price },
  }
}

/**
 * Build the service value.
 *
 * `source` is the panel's own `catalogModels()` reader; `revision` a closure
 * the panel bumps on every announced change. Keeping both as functions means
 * the value never pins a stale catalog — a consumer that calls `models()` after
 * a reload always sees the live one.
 */
export function createWorkBuddy2ApiCatalog(
  source: () => readonly CatalogModel[],
  revision: () => number,
): WorkBuddy2ApiCatalog {
  return {
    serviceVersion: WORKBUDDY2API_CATALOG_SERVICE_VERSION,
    revision,
    models: () => source().map(toCatalogModel),
    model: id => {
      const found = source().find(model => model.id === id)
      return found === undefined ? undefined : toCatalogModel(found)
    },
    unitPricing: () => UNIT_CREDIT_PRICING,
  }
}
