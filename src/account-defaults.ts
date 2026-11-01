/**
 * The account the user picked by hand, remembered per realm.
 *
 * A pin lives in the kernel's session table, keyed by the client's session id —
 * so a brand-new conversation, or a restart that drops that table, starts from
 * the pool's own choice again. That is the wrong default for a person who just
 * said "always use this account": the pick was a decision, not an inference.
 *
 * This module keeps the decision. It stores one uid per realm, and the chip uses
 * it to re-create the pin whenever it sees a session that has none. The file is
 * deliberately tiny and separate from the connection document: deleting it
 * returns the plugin to pure pool allocation without touching anything else.
 *
 * @module dsh-workbuddy2api-gateway/account-defaults
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { accountDefaultsPath } from './paths.ts'

/** Format version of the defaults document. */
const VERSION = 1

/** One remembered pick per realm; absent means "let the pool choose". */
export interface AccountDefaults {
  version: number
  cn?: string
  global?: string
}

/** Read the document; a missing or unreadable file yields an empty one. */
export function readAccountDefaults(path: string = accountDefaultsPath()): AccountDefaults {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { version: VERSION }
    const record = parsed as Record<string, unknown>
    const document: AccountDefaults = { version: VERSION }
    if (typeof record['cn'] === 'string' && record['cn'] !== '') document.cn = record['cn']
    if (typeof record['global'] === 'string' && record['global'] !== '') document.global = record['global']
    return document
  } catch {
    return { version: VERSION }
  }
}

/** Write the document; returns false when the file could not be written. */
export function writeAccountDefaults(
  document: AccountDefaults,
  path: string = accountDefaultsPath(),
): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const payload: AccountDefaults = { version: VERSION }
    if (document.cn !== undefined) payload.cn = document.cn
    if (document.global !== undefined) payload.global = document.global
    writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}
