/**
 * The account order is shared by the settings table and the composer picker,
 * so its sort and its persistence are pinned here.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyAccountOrder, readAccountOrder, writeAccountOrder } from '../src/account-order.ts'

const accounts = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }]

describe('applyAccountOrder', () => {
  it('sorts named uids first in the saved order', () => {
    expect(applyAccountOrder(accounts, ['c', 'a']).map(account => account.uid)).toEqual(['c', 'a', 'b'])
  })

  it('keeps the incoming order when nothing is saved', () => {
    expect(applyAccountOrder(accounts, []).map(account => account.uid)).toEqual(['a', 'b', 'c'])
  })

  it('appends accounts the saved order does not name', () => {
    expect(applyAccountOrder(accounts, ['b']).map(account => account.uid)).toEqual(['b', 'a', 'c'])
  })
})

describe('account order persistence', () => {
  it('round-trips, dropping blanks and duplicates', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'wb2g-order-')), 'account-order.json')
    writeAccountOrder(['b', '', 'a', 'b', 'c'], path)
    expect(readAccountOrder(path)).toEqual(['b', 'a', 'c'])
  })

  it('answers an empty order when the file is missing', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'wb2g-order-')), 'none.json')
    expect(readAccountOrder(path)).toEqual([])
  })
})
