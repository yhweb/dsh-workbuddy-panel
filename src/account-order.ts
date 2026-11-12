/**
 * The user-controlled account order.
 *
 * The gateway reports its pool in its own (map) order, which is stable but
 * meaningless to a person. This document is the order the user dragged into
 * place; the settings table and the composer picker both read it, so a drag
 * in one list shows up in the other on the next poll. It is deliberately a
 * flat uid list: the settings table mixes realms, and the picker filters by
 * realm while preserving this relative order.
 *
 * The first account in this order is the one offered to the LAN as the
 * gateway account (see the service); DSH conversations prefer the rest.
 *
 * @module dsh-workbuddy2api-gateway/account-order
 */
import { readStoreDocument, writeStoreDocument } from './store-file.ts'
import { accountOrderPath } from './paths.ts'

/** Format version this build writes and accepts. */
const VERSION = 1

/** Read the saved order; a missing or unreadable file yields an empty list. */
export function readAccountOrder(path: string = accountOrderPath()): readonly string[] {
  const stored = readStoreDocument(path, VERSION, document => {
    const order = document['order']
    if (!Array.isArray(order)) return undefined
    const list = order.filter((uid): uid is string => typeof uid === 'string' && uid !== '')
    return list
  })
  return stored ?? []
}

/** Persist the order, dropping blanks and duplicates. Returns the sorted list written. */
export function writeAccountOrder(uids: readonly string[], path: string = accountOrderPath()): readonly string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const uid of uids) {
    if (typeof uid !== 'string' || uid === '' || seen.has(uid)) continue
    seen.add(uid)
    order.push(uid)
  }
  writeStoreDocument(path, { version: VERSION, order })
  return order
}

/**
 * Order accounts by a saved uid list.
 *
 * Known uids come first in the saved order; accounts the list does not name
 * keep their incoming (gateway) order after them, so a freshly added account
 * appears at the end rather than vanishing.
 */
export function applyAccountOrder<T extends { uid: string }>(accounts: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...accounts]
  const rank = new Map<string, number>()
  order.forEach((uid, index) => { if (!rank.has(uid)) rank.set(uid, index) })
  const ranked = accounts
    .map((account, index) => ({ account, index }))
    .sort((left, right) => {
      const leftRank = rank.get(left.account.uid)
      const rightRank = rank.get(right.account.uid)
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
      if (leftRank !== undefined) return -1
      if (rightRank !== undefined) return 1
      return left.index - right.index
    })
  return ranked.map(entry => entry.account)
}
