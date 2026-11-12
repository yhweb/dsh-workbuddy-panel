import { describe, expect, it } from 'vitest'
import { parseBuddyCredential, isRateLimited, diffAccounts, sinkRateLimited, readPanelCnAccounts } from '../src/providers-hub-bridge.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('parseBuddyCredential', () => {
  it('parses a providers-hub credential JSON', () => {
    const parsed = parseBuddyCredential(JSON.stringify({ access_token: 'a', user_id: 'u1' }))
    expect(parsed?.access_token).toBe('a')
    expect(parsed?.user_id).toBe('u1')
  })
  it('answers undefined for garbage', () => {
    expect(parseBuddyCredential('not json')).toBeUndefined()
    expect(parseBuddyCredential('"str"')).toBeUndefined()
  })
})

describe('isRateLimited', () => {
  it('detects an unexpired model limit', () => {
    const entry = { id: 'x', provider: 'buddy', nickname: 'n', enabled: true, credentialRef: 'r', createdAt: 1, modelRateLimits: { m: Date.now() + 60000 } }
    expect(isRateLimited(entry)).toBe(true)
  })
  it('ignores expired limits and absence', () => {
    const entry = { id: 'x', provider: 'buddy', nickname: 'n', enabled: true, credentialRef: 'r', createdAt: 1, modelRateLimits: { m: 1 } }
    expect(isRateLimited(entry)).toBe(false)
    expect(isRateLimited({ ...entry, modelRateLimits: undefined })).toBe(false)
  })
})

describe('diffAccounts', () => {
  it('splits uids by side', () => {
    const diff = diffAccounts([{ uid: 'a' }, { uid: 'b' }], [{ uid: 'b' }, { uid: 'c' }])
    expect(diff.onlyInPanel).toEqual(['a'])
    expect(diff.onlyInBuddy).toEqual(['c'])
  })
})

describe('sinkRateLimited', () => {
  it('moves limited uids to the end', () => {
    expect(sinkRateLimited(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c', 'b'])
  })
})

describe('readPanelCnAccounts', () => {
  it('reads cn accounts with tokens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb2g-auths-'))
    writeFileSync(join(dir, 'workbuddy-u1.json'), JSON.stringify({ account: { uid: 'u1', nickname: 'N' }, auth: { accessToken: 'AT', refreshToken: 'RT' } }))
    const accounts = readPanelCnAccounts(dir)
    expect(accounts).toEqual([{ uid: 'u1', nickname: 'N', accessToken: 'AT', refreshToken: 'RT' }])
  })
})
