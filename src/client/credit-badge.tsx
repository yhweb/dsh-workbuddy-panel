/**
 * The composer's account chip: which pool account a turn is spent from, how much
 * that account has left, and a picker that pins the choice to this conversation.
 *
 * The plugin registers two providers — the domestic route and the global route
 * — and their credits are not interchangeable. The chip therefore reads the
 * session's current model selection, picks the matching realm, and speaks only
 * about that realm's accounts. A model under another provider renders nothing: a
 * WorkBuddy figure attached to a turn that cannot spend it is worse than no
 * figure at all.
 *
 * **Which account?** The gateway's pool rotates per request, so by default there
 * is no single "the" account to read, and the chip shows the strongest evidence
 * available: the usable account of that realm that served the most recent
 * request. A conversation can also be *pinned*: the kernel keeps a session→
 * account table keyed by the id the client sends on every request, and a pinned
 * conversation is always spent from that account. When a pin exists it wins —
 * it is a decision the user made, not an inference.
 *
 * The picker is where the pin is made: one click on the chip, one click on an
 * account, and the action goes through the host's action route (never to the
 * gateway directly, so the API key stays in the host). A kernel that predates
 * the endpoints answers 404, which the status document reports as
 * "unsupported" and the picker states plainly instead of offering a dead button.
 *
 * It renders nothing when there is nothing to say: no gateway connection, no
 * matching accounts, or no credit figure at all. An annotation must never be a
 * requirement, and an empty "0" reads as a spent pool rather than as an unknown
 * one.
 *
 * @module dsh-workbuddy2api-gateway/client/credit-badge
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { isThinkingLevel } from '../catalog.ts'
import type { WebAccount } from '../service.ts'
import { postAction } from './status-document.ts'
import type { ClientAction } from './status-document.ts'
import type { PanelStore } from './store.ts'
import type { Translate } from './copy.ts'

/** The two pools the gateway serves; the picker switches between them. */
type Realm = 'cn' | 'global'

/** What the composer's account chip injects. */
export interface CreditBadgeProps {
  t: Translate
  store: PanelStore
  /** The session's shared model-selection store. */
  directory: ModelDirectory['store']
  /** The DSH session this chip sits in: the key the kernel's sticky table binds. */
  session?: string
}

/** Compact a credit figure: 4160 → 4,160. */
function grouped(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

/** Local MM-DD HH:mm for one ISO timestamp, or '' when unreadable. */
function shortMoment(value: string): string {
  const at = new Date(value)
  if (!Number.isFinite(at.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes())
}

/** 0001-01-01T00:00:00Z is the gateway's "never", not a timestamp. */
function isNever(value: string | undefined): boolean {
  return value === undefined || value.length === 0 || value.startsWith('0001-')
}

/** Which pool an account belongs to. */
function realmOf(account: WebAccount): Realm {
  return account.realm === 'global' ? 'global' : 'cn'
}

/**
 * The account a turn on this realm would most plausibly be spent from.
 *
 * @param pool - the accounts of one realm.
 */
function speakingAccount(pool: readonly WebAccount[]): WebAccount | undefined {
  const usable = pool.filter(account => account.status === 'active')
  const served = usable
    .filter(account => !isNever(account.lastSuccess))
    .sort((left, right) => Date.parse(right.lastSuccess ?? '') - Date.parse(left.lastSuccess ?? ''))
  if (served.length > 0) return served[0]
  return usable.length === 1 ? usable[0] : undefined
}

/**
 * Order the picker's rows: the one that served most recently first, then the
 * fullest, so the account a turn is most likely to land on is under the cursor.
 */
function rankAccounts(pool: readonly WebAccount[]): WebAccount[] {
  return [...pool].sort((left, right) => {
    const leftAt = isNever(left.lastSuccess) ? 0 : Date.parse(left.lastSuccess ?? '')
    const rightAt = isNever(right.lastSuccess) ? 0 : Date.parse(right.lastSuccess ?? '')
    if (leftAt !== rightAt) return rightAt - leftAt
    return (right.credits ?? -1) - (left.credits ?? -1)
  })
}


/** Rows and tabs are styled by class (see ui-styles.ts) so they follow the theme. */

/**
 * Render the selected realm's remaining credit and its picker, or nothing.
 *
 * The poll starts with the mount and stops with it, exactly like the settings
 * page's: the badge is a second reader of the same store, not a second poller.
 */
export function WorkBuddy2ApiCreditBadge({ t, store, directory, session }: CreditBadgeProps): ReactElement | null {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const subscribeDirectory = useCallback((listener: () => void) => directory.subscribe(listener), [directory])
  const readDirectory = useCallback(() => directory.getSnapshot(), [directory])
  const selection = useSyncExternalStore(subscribeDirectory, readDirectory, readDirectory).current
  useEffect(() => {
    store.start()
    return () => {
      store.stop()
    }
  }, [store])

  // Picker state. All of it lives here rather than in the store: it is one
  // popover's business, and the store is shared by four surfaces.
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Realm | undefined>(undefined)
  const [anchor, setAnchor] = useState<{ left: number, bottom: number } | undefined>(undefined)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const chip = useRef<HTMLButtonElement | null>(null)

  // A popover that cannot be dismissed is a trap: close on a click outside and
  // on Escape, both registered only while it is open.
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (chip.current !== null && chip.current.contains(target)) return
      for (const node of document.querySelectorAll('[data-wb2a-picker]')) {
        if (node.contains(target)) return
      }
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // DSH keeps the reasoning level in the session selection, but a model switch
  // rebuilds that selection from the model's default. Persist the level the user
  // actually picked for this model, so coming back finds it again.
  const persistedEfforts = useRef(new Map<string, string>())
  useEffect(() => {
    const currentSelection = selection
    const currentDocument = snapshot.document
    if (currentSelection === null || currentDocument === undefined) return
    if (!isThinkingLevel(currentSelection.reasoningEffort)) return
    const provider = currentSelection.provider
    const globalId = currentDocument.provider.global?.id
    if (provider !== currentDocument.provider.id && provider !== globalId) return
    const model = currentDocument.models.find(entry => entry.id === currentSelection.model)
    // Only a level that differs from the model's current default is a user
    // choice worth persisting; writing every default would mask later panel
    // changes for no reason.
    if (model === undefined || model.defaultEffort === currentSelection.reasoningEffort) return
    const modelKey = provider + '|' + currentSelection.model
    const key = modelKey + '|' + currentSelection.reasoningEffort
    if (persistedEfforts.current.get(modelKey) === key) return
    persistedEfforts.current.set(modelKey, key)
    void postAction({
      action: 'model',
      id: currentSelection.model,
      effort: currentSelection.reasoningEffort,
    }, currentDocument.controlKey).then(response => {
      // A transient failure can be retried on the next selection change.
      if (!response.ok && persistedEfforts.current.get(modelKey) === key) {
        persistedEfforts.current.delete(modelKey)
      }
    })
  }, [selection, snapshot.document])

  // A manual pick is remembered: it survives a restart and applies to new
  // conversations. The kernel's table is keyed by session, so a fresh session
  // starts empty — when this realm has a remembered account and this session has
  // no pin yet, the pin is re-created here. Guarded per (session, uid) so a
  // kernel that refuses cannot turn this into a loop.
  const autoBound = useRef<string | undefined>(undefined)
  useEffect(() => {
    const currentDocument = snapshot.document
    if (session === undefined || currentDocument === undefined) return
    const support = currentDocument.sessions
    if (support === undefined || support.supported !== true) return
    if (support.bindings.some(binding => binding.key === session)) return
    const currentSelection = selection
    if (currentSelection === null) return
    const selectedRealm = currentSelection.provider === currentDocument.provider.global.id
      ? 'global'
      : currentSelection.provider === currentDocument.provider.id
        ? 'cn'
        : undefined
    if (selectedRealm === undefined) return
    const remembered = support.defaults === undefined ? undefined : support.defaults[selectedRealm]
    if (remembered === undefined) return
    const account = currentDocument.accounts.find(entry => entry.uid === remembered)
    if (account === undefined || account.status !== 'active') return
    const marker = session + '|' + remembered
    if (autoBound.current === marker) return
    autoBound.current = marker
    void postAction({ action: 'session-bind', session, uid: remembered }, currentDocument.controlKey)
      .then(response => {
        if (!response.ok) autoBound.current = undefined
      })
  }, [session, snapshot.document, selection])

  const document_ = snapshot.document
  if (document_ === undefined || !document_.panel.connected || document_.accounts.length === 0) return null
  if (selection === null) return null
  const realm: Realm | undefined = selection.provider === document_.provider.global.id
    ? 'global'
    : selection.provider === document_.provider.id
      ? 'cn'
      : undefined
  if (realm === undefined) return null
  const pool = document_.accounts.filter(account => realmOf(account) === realm)
  const known = pool.filter(account => account.credits !== undefined)
  if (known.length === 0) return null
  const total = known.reduce((sum, account) => sum + (account.credits ?? 0), 0)
  const creditsWord = t('creditsLabel')
  const scopeLabel = realm === 'global' ? t('realmGlobalShort') : t('creditsRealmCn')
  const statusText = (status: WebAccount['status']): string => (
    status === 'cooling'
      ? t('accountStatusCooling')
      : status === 'paused'
        ? t('accountStatusPaused')
        : status === 'disabled'
          ? t('accountStatusDisabled')
          : t('accountStatusActive'))
  const nameOf = (account: WebAccount): string => (
    account.nickname === '' ? account.uid.slice(0, 8) : account.nickname)
  const creditsOf = (account: WebAccount): string => (
    account.credits === undefined ? '—' : grouped(account.credits) + ' ' + creditsWord)

  const controlKey = document_.controlKey
  const sessions = document_.sessions
  const bindings = sessions === undefined ? [] : sessions.bindings
  const boundUid = session === undefined
    ? undefined
    : bindings.find(binding => binding.key === session)?.uid
  const boundAccount = boundUid === undefined
    ? undefined
    : document_.accounts.find(account => account.uid === boundUid)
  // A pin is the user's decision and outranks the inference; the inference is
  // only what the chip can honestly say when nobody has pinned anything.
  const current = boundAccount !== undefined && boundAccount.credits !== undefined
    ? boundAccount
    : speakingAccount(pool)
  const shown = current?.credits ?? total
  const who = current === undefined ? t('panelAccountsTitle') : nameOf(current)

  // The chip is one line; the pool behind it is a tooltip, so the figure stays
  // readable in a 32px row without hiding what it is made of.
  const lines = [t('creditsLeftHint'), t('creditChipCurrent', who, scopeLabel)]
  if (boundAccount !== undefined) lines.push(t('chipBound', nameOf(boundAccount)))
  if (current?.credits !== undefined) {
    lines.push(current.creditsTotal === undefined
      ? t('creditChipRemaining', grouped(current.credits), creditsWord)
      : t('creditChipRemainingTotal', grouped(current.credits), grouped(current.creditsTotal), creditsWord))
  }
  if (current !== undefined && !isNever(current.lastSuccess)) {
    const moment = shortMoment(current.lastSuccess ?? '')
    if (moment !== '') {
      lines.push(t('creditChipLast', moment, current.lastModel === undefined ? '' : ' · ' + current.lastModel))
    }
  }
  lines.push('', t('creditChipPool', scopeLabel, String(known.length), grouped(total), creditsWord))
  for (const account of pool.slice(0, 6)) {
    lines.push('· ' + nameOf(account) + ' — ' + creditsOf(account) + ' · ' + statusText(account.status))
  }
  if (pool.length > 6) lines.push(t('creditChipMore', String(pool.length)))
  lines.push('', t('creditChipPoolNote'), t('chipPickerHint'))

  const toggle = (): void => {
    if (!open && chip.current !== null && typeof window !== 'undefined') {
      const rect = chip.current.getBoundingClientRect()
      setAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 })
    }
    setTab(undefined)
    setNote(undefined)
    setOpen(!open)
  }

  /** Run one action, fold the result back, and say so when it fails. */
  const send = async (action: ClientAction, key: string): Promise<boolean> => {
    setBusy(key)
    const response = await postAction(action, controlKey)
    setBusy(undefined)
    if (!response.ok) {
      setNote(response.message === undefined || response.message === '' ? t('chipFailed') : response.message)
      return false
    }
    await store.refresh()
    return true
  }

  const pick = async (account: WebAccount): Promise<void> => {
    if (session === undefined) {
      setNote(t('chipNoSession'))
      return
    }
    if (account.uid === boundUid) return
    if (await send({ action: 'session-bind', session, uid: account.uid }, account.uid)) setOpen(false)
  }

  const release = async (): Promise<void> => {
    if (session === undefined) return
    if (await send({ action: 'session-unbind', session }, 'release')) setOpen(false)
  }

  const refreshCredit = async (): Promise<void> => {
    if (current === undefined) return
    if (await send({ action: 'account', uid: current.uid, op: 'balance' }, 'balance')) {
      setNote(t('chipBalanceQueued'))
    }
  }

  const activeRealm: Realm = tab ?? realm
  const rows = rankAccounts(document_.accounts.filter(account => realmOf(account) === activeRealm))
  const pending = busy !== undefined

  return (
    <>
      <button
        ref={chip}
        type="button"
        className="cs-creditBadge wb2aChip"
        title={lines.join('\n')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="wb2aDot" data-tone={boundUid === undefined ? 'muted' : 'ok'} />
        <b>{who}</b>
        <span className="wb2aChipUnit">•</span>
        <span className="wb2aChipNum">{grouped(shown)}</span>
        <span className="wb2aChipUnit">{creditsWord}</span>
      </button>
      {open ? (
        <div
          data-wb2a-picker=""
          role="dialog"
          aria-label={t('chipPickerTitle')}
          className="wb2aPop"
          style={{ left: anchor === undefined ? 12 : anchor.left, bottom: anchor === undefined ? undefined : anchor.bottom }}
        >
          <div className="wb2aPopHead">
            <span className="wb2aTabs">
              {(['cn', 'global'] as const).map(id => (
                <button
                  key={id}
                  type="button"
                  className="wb2aTab"
                  data-on={activeRealm === id}
                  onClick={() => {
                    setTab(id)
                    setNote(undefined)
                  }}
                >
                  {id === 'cn' ? t('creditsRealmCn') : t('realmGlobalShort')}
                </button>
              ))}
            </span>
            <span style={{ flex: 1 }} />
            <span className="wb2aRowTag">{t('chipPickerTitle')}</span>
          </div>
          {sessions !== undefined && sessions.supported === false ? (
            <div style={{ padding: '4px 2px', opacity: 0.78 }}>{t('chipKernelHint')}</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '4px 2px', opacity: 0.7 }}>{t('chipPickerEmpty')}</div>
          ) : rows.map(account => {
            const pinned = account.uid === boundUid
            const dot = pinned ? 'ok' : account.status === 'active' ? 'ok' : 'warn'
            return (
              <button
                key={account.uid}
                type="button"
                disabled={pinned || pending}
                onClick={() => {
                  void pick(account)
                }}
                title={statusText(account.status)
                  + (isNever(account.lastSuccess) ? '' : ' · ' + shortMoment(account.lastSuccess ?? ''))}
                className="wb2aRow"
                data-pinned={pinned}
                style={{ opacity: pending && !pinned ? 0.6 : 1 }}
              >
                <span className="wb2aDot" data-tone={dot} />
                <span className="wb2aRowName" style={{ fontWeight: pinned ? 600 : 400 }}>{nameOf(account)}</span>
                <span style={{ flex: 1 }} />
                <span className="wb2aRowNum">{creditsOf(account)}</span>
                {pinned ? <span className="wb2aRowTag">{t('chipInUse')}</span> : null}
                {busy === account.uid ? <span className="wb2aRowTag">{t('chipBusy')}</span> : null}
              </button>
            )
          })}
          <div className="wb2aFoot">
            <button
              type="button"
              disabled={boundUid === undefined || pending}
              onClick={() => {
                void release()
              }}
              className="wb2aLink"
              style={{ opacity: boundUid === undefined ? 0.45 : 1 }}
            >
              {t('chipRelease')}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              disabled={current === undefined || pending}
              onClick={() => {
                void refreshCredit()
              }}
              className="wb2aLink"
              style={{ opacity: current === undefined ? 0.45 : 1 }}
            >
              {busy === 'balance' ? t('chipBusy') : t('chipRefreshBalance')}
            </button>
          </div>
          {note === undefined ? null : <div className="wb2aFootNote">{note}</div>}
          <div className="wb2aFootNote">{t('chipPickerNote')}</div>
        </div>
      ) : null}
    </>
  )
}
