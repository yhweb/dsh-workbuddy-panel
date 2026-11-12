/**
 * Optional bridge to dsh-providers-hub for the cn (Tencent CodeBuddy) pool.
 *
 * The panel and providers-hub both hold Tencent CodeBuddy accounts, but store
 * them in unrelated places and name them differently. This module reconciles the
 * two so a drag or an added account in either plugin lands in the other. It is
 * deliberately self-contained and optional: providers-hub registers its
 * `accountPool` and the host registers `credentials`; when either is absent this
 * bridge reports `absent` and the panel behaves exactly as before.
 *
 * Identity: a CodeBuddy account is the same person when the panel account uid
 * (Tencent user id) equals the providers-hub credential user_id. Access tokens
 * rotate, the uid does not, so the uid is the stable key.
 *
 * Ordering: providers-hub is authoritative. The panel pushes its drags to
 * providers-hub and re-reads the authoritative order back. Rate-limited accounts
 * sink to the end on both sides.
 *
 * @module dsh-workbuddy2api-gateway/providers-hub-bridge
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gatewayWorkdir } from './paths.ts'

export interface PanelCnAccount {
  uid: string
  nickname: string
  accessToken: string
  refreshToken: string
}

export interface BuddyAccountView {
  uid: string
  nickname: string
  accessToken: string
  refreshToken: string
  domain: string
  expiresAt?: number
  enabled: boolean
  rateLimited: boolean
  accountId: string
  credentialRef: string
}

export interface AccountPoolLike {
  listAccounts(provider: string): Promise<BuddyAccountEntry[]>
  addAccount(entry: BuddyAccountEntry): Promise<void>
  removeAccount(id: string): Promise<void>
  reorderAccounts(provider: string, orderedIds: readonly string[]): Promise<void>
  resolveCredentialForAccount(id: string): Promise<Record<string, unknown> | undefined>
}

export interface BuddyAccountEntry {
  id: string
  provider: string
  nickname: string
  enabled: boolean
  credentialRef: string
  createdAt: number
  expiresAt?: number
  modelRateLimits?: Record<string, number>
}

export interface CredentialsLike {
  resolve(ref: unknown): Promise<{ value: string } | undefined>
  set(ref: unknown, value: string): Promise<void>
}

interface BuddyCredentialPayload {
  access_token?: unknown
  refresh_token?: unknown
  domain?: unknown
  user_id?: unknown
  nickname?: unknown
  expires_at?: unknown
}

export function parseBuddyCredential(value: string): BuddyCredentialPayload | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as BuddyCredentialPayload
      : undefined
  } catch {
    return undefined
  }
}

export function isRateLimited(entry: BuddyAccountEntry, now = Date.now()): boolean {
  const limits = entry.modelRateLimits
  if (limits === undefined) return false
  return Object.values(limits).some(resetAtMs => typeof resetAtMs === 'number' && resetAtMs > now)
}

export function diffAccounts(
  panel: readonly { uid: string }[],
  buddy: readonly { uid: string }[],
): { onlyInPanel: string[], onlyInBuddy: string[] } {
  const panelSet = new Set(panel.map(account => account.uid))
  const buddySet = new Set(buddy.map(account => account.uid))
  return {
    onlyInPanel: [...panelSet].filter(uid => !buddySet.has(uid)),
    onlyInBuddy: [...buddySet].filter(uid => !panelSet.has(uid)),
  }
}

export function sinkRateLimited(order: readonly string[], rateLimited: ReadonlySet<string>): string[] {
  const normal: string[] = []
  const sunk: string[] = []
  for (const uid of order) {
    ;(rateLimited.has(uid) ? sunk : normal).push(uid)
  }
  return [...normal, ...sunk]
}

/**
 * Write one buddy account into the gateway auths directory as a cn account.
 * The realm and domain come from the credential; a workbuddy (global) credential
 * is deliberately skipped so the bridge never mislabels an international account.
 * Returns true when the file was written.
 */
export function writePanelCnAccount(
  account: BuddyAccountView,
  authsDir: string = join(gatewayWorkdir(), 'auths'),
): boolean {
  if (account.uid === '' || account.accessToken === '') return false
  const realm = account.domain === 'www.workbuddy.ai' ? 'global' : 'cn'
  const document = {
    account: {
      enterpriseId: '',
      nickname: account.nickname,
      uid: account.uid,
    },
    auth: {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      domain: account.domain,
      realm,
      ...account.expiresAt === undefined ? {} : { expiresAt: account.expiresAt },
    },
  }
  try {
    mkdirSync(authsDir, { recursive: true })
    writeFileSync(join(authsDir, 'workbuddy-' + account.uid + '.json'), JSON.stringify(document, null, 2) + '\n')
    return true
  } catch {
    return false
  }
}

export function readPanelCnAccounts(authsDir: string = join(gatewayWorkdir(), 'auths')): PanelCnAccount[] {
  if (!existsSync(authsDir)) return []
  const out: PanelCnAccount[] = []
  for (const name of readdirSync(authsDir)) {
    if (!name.endsWith('.json')) continue
    try {
      const document = JSON.parse(readFileSync(join(authsDir, name), 'utf8')) as Record<string, unknown>
      const account = document['account'] as Record<string, unknown> | undefined
      const auth = document['auth'] as Record<string, unknown> | undefined
      if (account === undefined || auth === undefined) continue
      const uid = typeof account['uid'] === 'string' ? account['uid'] : undefined
      const accessToken = typeof auth?.['accessToken'] === 'string' ? auth['accessToken'] : undefined
      if (uid === undefined || accessToken === undefined) continue
      out.push({
        uid,
        nickname: typeof account['nickname'] === 'string' ? account['nickname'] : '',
        accessToken,
        refreshToken: typeof auth['refreshToken'] === 'string' ? auth['refreshToken'] : '',
      })
    } catch {
      // A malformed auth file must not take the whole reconcile down.
    }
  }
  return out
}

export interface ProvidersHubBridge {
  availability(): 'absent' | 'present'
  listBuddyAccounts(): Promise<BuddyAccountView[]>
  reconcile(panel: readonly PanelCnAccount[]): Promise<ReconcileResult>
  pushOrder(orderedUids: readonly string[]): Promise<void>
  pullOrder(): Promise<string[]>
}

export interface ReconcileResult {
  availability: 'absent' | 'present'
  addedToProvidersHub: number
  addedToPanel: number
  order: string[]
}

interface BridgeDeps {
  accountPool: AccountPoolLike
  credentials: CredentialsLike
}

export function createProvidersHubBridge(resolve: () => BridgeDeps | undefined): ProvidersHubBridge {
  const availability = (): 'absent' | 'present' => resolve() === undefined ? 'absent' : 'present'

  const listBuddyAccounts = async (): Promise<BuddyAccountView[]> => {
    const deps = resolve()
    if (deps === undefined) return []
    const entries = await deps.accountPool.listAccounts('buddy')
    const out: BuddyAccountView[] = []
    for (const entry of entries) {
      const credential = await deps.accountPool.resolveCredentialForAccount(entry.id)
      const payload = credential as BuddyCredentialPayload | undefined
      const uid = typeof payload?.user_id === 'string' ? payload.user_id : ''
      out.push({
        uid,
        nickname: entry.nickname,
        accessToken: typeof payload?.access_token === 'string' ? payload.access_token : '',
        refreshToken: typeof payload?.refresh_token === 'string' ? payload.refresh_token : '',
        domain: typeof payload?.domain === 'string' ? payload.domain : 'www.codebuddy.cn',
        ...typeof payload?.expires_at === 'number' ? { expiresAt: payload.expires_at } : {},
        enabled: entry.enabled,
        rateLimited: isRateLimited(entry),
        accountId: entry.id,
        credentialRef: entry.credentialRef,
      })
    }
    return out
  }

  const pullOrder = async (): Promise<string[]> => {
    const views = await listBuddyAccounts()
    const rateLimited = new Set(views.filter(view => view.rateLimited).map(view => view.uid))
    const order = views.map(view => view.uid).filter(uid => uid !== '')
    return sinkRateLimited(order, rateLimited)
  }

  const reconcile = async (panel: readonly PanelCnAccount[]): Promise<ReconcileResult> => {
    const deps = resolve()
    if (deps === undefined) return { availability: 'absent', addedToProvidersHub: 0, addedToPanel: 0, order: [] }
    const buddy = await listBuddyAccounts()
    const { onlyInPanel, onlyInBuddy } = diffAccounts(panel, buddy)
    let addedToProvidersHub = 0
    for (const uid of onlyInPanel) {
      const source = panel.find(account => account.uid === uid)
      if (source === undefined) continue
      if (await addToProvidersHub(deps, source)) addedToProvidersHub += 1
    }
    let addedToPanel = 0
    for (const uid of onlyInBuddy) {
      const source = buddy.find(account => account.uid === uid)
      if (source === undefined) continue
      if (writePanelCnAccount(source)) addedToPanel += 1
    }
    const order = await pullOrder()
    return {
      availability: 'present',
      addedToProvidersHub,
      addedToPanel,
      order,
    }
  }

  const pushOrder = async (orderedUids: readonly string[]): Promise<void> => {
    const deps = resolve()
    if (deps === undefined) return
    const entries = await deps.accountPool.listAccounts('buddy')
    const orderedIds: string[] = []
    for (const uid of orderedUids) {
      const entry = await findEntryByUid(deps, uid)
      if (entry !== undefined) orderedIds.push(entry.id)
    }
    if (orderedIds.length === 0) return
    for (const entry of entries) {
      if (!orderedIds.includes(entry.id)) orderedIds.push(entry.id)
    }
    await deps.accountPool.reorderAccounts('buddy', orderedIds)
  }

  return { availability, listBuddyAccounts, reconcile, pushOrder, pullOrder }
}

async function findEntryByUid(deps: BridgeDeps, uid: string): Promise<BuddyAccountEntry | undefined> {
  const entries = await deps.accountPool.listAccounts('buddy')
  for (const entry of entries) {
    const credential = await deps.accountPool.resolveCredentialForAccount(entry.id)
    const payload = credential as BuddyCredentialPayload | undefined
    if (typeof payload?.user_id === 'string' && payload.user_id === uid) return entry
  }
  return undefined
}

async function addToProvidersHub(deps: BridgeDeps, account: PanelCnAccount): Promise<boolean> {
  try {
    const suffix = shortHex()
    const refName = 'BUDDY_ACCOUNT_' + suffix.toUpperCase()
    const credential: BuddyCredentialPayload = {
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
      domain: 'www.codebuddy.cn',
      user_id: account.uid,
      nickname: account.nickname,
    }
    await deps.credentials.set(refName, JSON.stringify(credential))
    const entry: BuddyAccountEntry = {
      id: 'buddy-' + shortHex(),
      provider: 'buddy',
      nickname: account.nickname || account.uid,
      enabled: true,
      credentialRef: refName,
      createdAt: Date.now(),
    }
    await deps.accountPool.addAccount(entry)
    return true
  } catch {
    return false
  }
}

function shortHex(): string {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  return Array.from(buf, byte => byte.toString(16).padStart(2, '0')).join('')
}
