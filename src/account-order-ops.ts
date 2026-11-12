/**
 * Pure reordering rules for the shared account order.
 *
 * Two rules live here, and both the settings table and the composer picker use
 * them so a drag in either list obeys the same law:
 *
 * 1. A **global (international) account** only ever sits at the very top or the
 *    very bottom of the list. Dragging it upward parks it first; dragging it
 *    downward parks it last — independent of which row it was dropped onto.
 *    This is a panel-only placement: it changes the panel order but never the
 *    providers-hub pool, because the bridge only mirrors the cn accounts.
 *
 * 2. **cn accounts** reorder among themselves but never displace the globals
 *    pinned at the head and the tail.
 *
 * The module is deliberately free of I/O and of any Node import so the browser
 * bundle can share it with the host. The caller injects `isGlobal`, so the same
 * functions work against either a full Realm string or a precomputed set.
 *
 * @module dsh-workbuddy2api-gateway/account-order-ops
 */

/** Split a flat order into the head globals, the cn middle run, and the tail globals. */
function splitEdges(
  uids: readonly string[],
  isGlobal: (uid: string) => boolean,
): { head: string[], middle: string[], tail: string[] } {
  const head: string[] = []
  let h = 0
  while (h < uids.length) {
    const uid = uids[h]
    if (uid === undefined || !isGlobal(uid)) break
    head.push(uid); h++
  }
  const tail: string[] = []
  let t = uids.length - 1
  while (t >= h) {
    const uid = uids[t]
    if (uid === undefined || !isGlobal(uid)) break
    tail.unshift(uid); t--
  }
  return { head, middle: uids.slice(h, t + 1), tail }
}

/**
 * Compute the order after dropping `fromUid` onto `toUid`.
 *
 * Returns a fresh array; the input is never mutated. When either uid is unknown
 * the order is returned unchanged.
 */
export function reorderAccountUids(
  uids: readonly string[],
  fromUid: string,
  toUid: string,
  isGlobal: (uid: string) => boolean,
): string[] {
  if (fromUid === toUid) return [...uids]
  const from = uids.indexOf(fromUid)
  const to = uids.indexOf(toUid)
  if (from < 0 || to < 0) return [...uids]

  // A global account snaps to an edge: up => first, down => last.
  if (isGlobal(fromUid)) {
    const moving = uids[from]
    if (moving === undefined) return [...uids]
    const rest = uids.filter((_, index) => index !== from)
    if (to < from) rest.unshift(moving)
    else rest.push(moving)
    return rest
  }

  // A cn account moves inside the cn window; edge globals stay put.
  const { head, middle, tail } = splitEdges(uids, isGlobal)
  const cnFrom = middle.indexOf(fromUid)
  if (cnFrom < 0) return [...uids]
  let cnTo: number
  if (isGlobal(toUid)) {
    cnTo = to < head.length ? 0 : middle.length
  } else {
    cnTo = middle.indexOf(toUid)
  }
  if (cnTo < 0) cnTo = middle.length
  const spliced = middle.splice(cnFrom, 1)
  const moved = spliced[0]
  if (moved === undefined) return [...uids]
  // Keep the original drop semantics: moving down lands just after the target,
  // moving up lands just before it. In middle coordinates both are index cnTo.
  let insert = cnTo
  if (insert < 0) insert = 0
  if (insert > middle.length) insert = middle.length
  middle.splice(insert, 0, moved)
  return [...head, ...middle, ...tail]
}

/**
 * Merge a providers-hub cn order into the panel's current order.
 *
 * The panel keeps its head/tail globals exactly where they are; the cn accounts
 * are reordered to follow `providerCn`, and any cn account the provider does not
 * name keeps its current relative position after the named ones. Uids the panel
 * does not hold are ignored.
 */
export function mergeProviderOrder(
  current: readonly string[],
  providerCn: readonly string[],
  isGlobal: (uid: string) => boolean,
): string[] {
  const { head, middle, tail } = splitEdges(current, isGlobal)
  const cnCurrent = middle.filter(uid => !isGlobal(uid))
  const cnCurrentSet = new Set(cnCurrent)
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const uid of providerCn) {
    if (cnCurrentSet.has(uid) && !seen.has(uid)) { ordered.push(uid); seen.add(uid) }
  }
  for (const uid of cnCurrent) {
    if (!seen.has(uid)) { ordered.push(uid); seen.add(uid) }
  }
  return [...head, ...ordered, ...tail]
}
