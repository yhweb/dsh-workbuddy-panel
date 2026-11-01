/**
 * The session's spend, in the composer's dock row.
 *
 * The number is the kernel's own ledger of the upstream `usage.credit` — the same
 * figure WorkBuddy books — so it follows a price or free-tier change without any
 * local price table. It is deliberately NOT in the badge: the badge answers
 * "which account", this answers "how much has this conversation cost".
 *
 * It reads through the host's action route (never the gateway directly), polls at
 * the same cadence as the rest of the plugin, and renders nothing until the
 * kernel has actually recorded a request for this session — an empty "0" would
 * read as "free" rather than "not measured yet".
 *
 * @module dsh-workbuddy2api-gateway/client/turn-credits
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { postAction } from './status-document.ts'
import type { PanelStore } from './store.ts'
import type { Translate } from './copy.ts'

/** What the composer dock injects. */
export interface TurnCreditsProps {
  t: Translate
  store: PanelStore
  /** The DSH session id; absent on surfaces without a session. */
  session?: string
}

/** Poll cadence: the same 5s the status document uses. */
const POLL_MS = 5_000

/** Render this conversation's accumulated spend, or nothing. */
export function WorkBuddy2ApiTurnCredits({ t, store, session }: TurnCreditsProps): ReactElement | null {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [usage, setUsage] = useState<{ credits: number, requests: number } | undefined>(undefined)

  useEffect(() => {
    store.start()
    return () => {
      store.stop()
    }
  }, [store])

  useEffect(() => {
    const document = snapshot.document
    if (session === undefined || document === undefined) return
    let cancelled = false
    const read = async (): Promise<void> => {
      const response = await postAction({ action: 'session-credits', session }, document.controlKey)
      if (cancelled) return
      const credits = response.credits
      if (!response.ok || credits === undefined || !credits.found || credits.requests <= 0) {
        setUsage(undefined)
        return
      }
      setUsage({ credits: credits.credits, requests: credits.requests })
    }
    void read()
    const timer = setInterval(() => {
      void read()
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [session, snapshot.document])

  if (usage === undefined) return null
  return (
    <span className="wb2aTurnCost" title={t('turnCostHint')}>
      {t('turnCost', usage.credits.toFixed(2), String(usage.requests))}
    </span>
  )
}
