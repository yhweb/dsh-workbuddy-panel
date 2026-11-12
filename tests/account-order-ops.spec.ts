/**
 * The reorder rules shared by both drag surfaces. These pin the two behaviours a
 * drag must obey: a global account only ever lands first or last, and a cn drag
 * never pushes a global account out of its edge slot.
 */
import { describe, expect, it } from 'vitest'
import { reorderAccountUids, mergeProviderOrder } from '../src/account-order-ops.ts'

const globals = new Set(['g1', 'g2'])
const isGlobal = (uid: string): boolean => globals.has(uid)

describe('reorderAccountUids — global accounts snap to an edge', () => {
  it('moves a global dragged upward to the very first slot', () => {
    const order = ['c1', 'c2', 'g1', 'c3']
    expect(reorderAccountUids(order, 'g1', 'c1', isGlobal)).toEqual(['g1', 'c1', 'c2', 'c3'])
  })

  it('moves a global dragged downward to the very last slot', () => {
    const order = ['c1', 'g1', 'c2', 'c3']
    expect(reorderAccountUids(order, 'g1', 'c3', isGlobal)).toEqual(['c1', 'c2', 'c3', 'g1'])
  })

  it('keeps a global first regardless of which middle row it was dropped on', () => {
    const order = ['c1', 'c2', 'c3', 'g1']
    expect(reorderAccountUids(order, 'g1', 'c2', isGlobal)).toEqual(['g1', 'c1', 'c2', 'c3'])
  })
})

describe('reorderAccountUids — cn accounts stay inside the global frame', () => {
  it('reorders two cn accounts without moving the tail global', () => {
    const order = ['g1', 'c1', 'c2', 'c3', 'g2']
    expect(reorderAccountUids(order, 'c1', 'c3', isGlobal)).toEqual(['g1', 'c2', 'c3', 'c1', 'g2'])
  })

  it('clamps a cn dropped on the head global to the start of the cn run', () => {
    const order = ['g1', 'c1', 'c2', 'c3']
    expect(reorderAccountUids(order, 'c3', 'g1', isGlobal)).toEqual(['g1', 'c3', 'c1', 'c2'])
  })

  it('clamps a cn dropped on the tail global to the end of the cn run', () => {
    const order = ['c1', 'c2', 'c3', 'g2']
    expect(reorderAccountUids(order, 'c1', 'g2', isGlobal)).toEqual(['c2', 'c3', 'c1', 'g2'])
  })

  it('leaves the order untouched for an unknown uid', () => {
    const order = ['c1', 'c2']
    expect(reorderAccountUids(order, 'x', 'c1', isGlobal)).toEqual(['c1', 'c2'])
  })
})

describe('mergeProviderOrder — providers-hub is authoritative for cn', () => {
  it('reorders cn to follow the provider while keeping edge globals', () => {
    const current = ['g1', 'c1', 'c2', 'c3', 'g2']
    const provider = ['c3', 'c1', 'c2']
    expect(mergeProviderOrder(current, provider, isGlobal)).toEqual(['g1', 'c3', 'c1', 'c2', 'g2'])
  })

  it('keeps cn accounts the provider omits, after the named ones', () => {
    const current = ['c1', 'c2', 'c3']
    const provider = ['c3']
    expect(mergeProviderOrder(current, provider, isGlobal)).toEqual(['c3', 'c1', 'c2'])
  })

  it('ignores provider uids the panel does not hold', () => {
    const current = ['c1', 'c2']
    const provider = ['cX', 'c2', 'c1']
    expect(mergeProviderOrder(current, provider, isGlobal)).toEqual(['c2', 'c1'])
  })
})
