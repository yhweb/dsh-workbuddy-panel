import { a as GatewayLogLine, c as KernelCheckCadence, d as ServerDownloadStatus, f as ServerStatus, i as GatewayHost, l as KernelUpdateStatus, n as GATEWAY_HOST_SERVICE, o as GatewayState, r as GATEWAY_HOST_SERVICE_VERSION, s as GatewayStatus, t as DeviceSignalStatus, u as ServerDownloadState } from "./gateway-contract-r1m7qjxn.js";
import z from "@deepseek-ai/schemastery";
import { ImageAttachmentAccess } from "@deepseek-ai/dsh-llm";
import "@earendil-works/pi-ai";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { Context } from "@deepseek-ai/cordis";
import { AttachmentStore, ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
/**
 * Reading the gateway's own usage ledger.
 *
 * The gateway writes one bucket per (hour, realm, account, model) into
 * `data/usage.json`; that file is the only place a token count and a credit
 * charge exist side by side, which is exactly what the overview needs to offer
 * "tokens or credits" as one switch over the same history.
 *
 * Two rules keep this honest:
 *
 * 1. **A missing or unreadable ledger is empty, not an error.** The file appears
 *    on the gateway's first request and is rewritten constantly; a read that
 *    races a write must not fail the whole status document.
 * 2. **The series is dense.** Every day of the window is present, zero-filled,
 *    because a heat map with holes draws a different story than a quiet week.
 *
 * @module dsh-workbuddy2api-gateway/usage
 */
/** One day of usage. */
interface UsageDay {
  /** ISO date (`YYYY-MM-DD`). */
  date: string;
  /** Requests recorded that day. */
  calls: number;
  /** Total tokens that day. */
  tokens: number;
  /** Credits charged that day. */
  credits: number;
}
/** What the overview renders. */
interface UsageSummary {
  /** The window, oldest first, dense (missing days are zero-filled). */
  days: readonly UsageDay[];
  calls: number;
  tokens: number;
  credits: number;
  /** Days with any recorded request. */
  activeDays: number;
  /** Hour of day (0-23) with the most tokens, when there is one. */
  peakHour?: number;
  /** Model id used by the most requests, when there is one. */
  topModel?: string;
  /** Whether any bucket was read at all. */
  empty: boolean;
}
/**
 * Typed client for a local `workbuddy2api-panel` (`/panel/api/*`).
 *
 * Everything the manager surface needs goes through here: the account pool
 * overview, the live model catalog, the panel configuration document, the OAuth
 * account-add flow, and the per-account operations. The panel is a Go process
 * on loopback that speaks the same OpenAI-compatible wire as `/v1`; this module
 * owns only its admin API.
 *
 * Two policies:
 *
 * - **Never throw on a shape surprise.** A panel behind an older revision, a
 *   proxy that answered HTML, or a field that moved all degrade to an empty or
 *   partial value plus a diagnosable message, because the surfaces that read
 *   this are status pages — a strict decoder would turn "one field missing"
 *   into "the whole plugin is down".
 * - **Redact on the way out.** Error text can echo a URL with a query string;
 *   `safeMessage` strips token-shaped material before it reaches the browser.
 *
 * @module dsh-workbuddy2api-connect/panel-client
 */
/** Where to reach the panel, and with which key. */
interface PanelEndpoint {
  /** Panel origin, e.g. `http://127.0.0.1:7863` (no trailing slash, no `/v1`). */
  baseUrl: string;
  /** Panel `api_key`; empty when the panel runs without auth. */
  apiKey: string;
}
/** Failure classes the surfaces distinguish. */
type PanelErrorKind = 'auth' | 'network' | 'http' | 'shape';
/** One diagnosable panel failure. */
declare class PanelError extends Error {
  readonly kind: PanelErrorKind;
  readonly status?: number | undefined;
  constructor(message: string, kind: PanelErrorKind, status?: number | undefined);
}
/** One pool account as the panel reports it. */
interface PanelAccount {
  uid: string;
  nickname: string;
  realm: string;
  credits?: number;
  creditsTotal?: number;
  creditsExpiring?: number;
  earliestExpiry?: string;
  disabled: boolean;
  disabledReason?: string;
  paused: boolean;
  cooling: boolean;
  coolingUntil?: string;
  coolingKind?: string;
  enterprise: boolean;
  tokenExpiresAt?: string;
  hasRefreshToken: boolean;
  checkinDone: boolean;
  successCount: number;
  errTotal: number;
  failStreak: number;
  inFlight: number;
  lastSuccess?: string;
  lastErr?: string;
  lastModel?: string;
  requestCount?: number;
  totalTokens?: number;
  lastLatencyMs?: number;
  rateLimitedModels: readonly {
    model: string;
    unlockAt?: string;
  }[];
}
/** Overview figures plus the pool listing. */
interface PanelOverview {
  version?: string;
  uptimeSec?: number;
  authRequired: boolean;
  redisMode?: string;
  total: number;
  healthy: number;
  cooling: number;
  disabled: number;
  paused: number;
  inFlightFull: boolean;
  accounts: readonly PanelAccount[];
  balanceRefreshSec?: number;
  balanceRefreshedAt?: string;
}
/** One model as the panel's live catalog reports it. */
interface PanelModel {
  id: string;
  name: string;
  description?: string;
  vendor?: string;
  credits?: string;
  contextLength: number;
  maxOutputTokens: number;
  supportedEfforts: readonly string[];
  defaultEffort?: string;
  canDisableThinking: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  onlyReasoning: boolean;
  tags: readonly string[];
}
/** A parsed panel configuration document; only the paths this plugin touches are typed. */
interface PanelConfigDocument {
  raw: Record<string, unknown>;
  hidden: readonly string[];
}
/** Outcome of an account add flow's poll. */
interface PanelLoginPoll {
  done: boolean;
  message?: string;
  uid?: string;
  nickname?: string;
}
/** Result of a panel write. */
interface PanelWriteResult {
  ok: boolean;
  message?: string;
  restartRequired?: readonly string[];
}
/** Redact token-shaped content before a message crosses to the browser. */
declare function safeMessage(error: unknown): string;
/** Normalize a user-supplied panel URL into an origin. */
declare function normalizePanelUrl(raw: string): string;
/** One session→account binding, as the kernel's session-sticky table reports it. */
/** Session-scoped spend, as the kernel reports it (its own ledger). */
interface PanelSessionCredits {
  /** False when the kernel has no record for this session yet. */
  found: boolean;
  credits: number;
  requests: number;
  lastAt?: string;
}
interface PanelBinding {
  key: string;
  uid: string;
  lastActive?: string;
}
/** The panel admin client. */
declare class PanelClient {
  private readonly endpoint;
  constructor(endpoint: () => PanelEndpoint);
  /** Current origin. */
  baseUrl(): string;
  /** The OpenAI-compatible base URL the route points at. */
  v1BaseUrl(): string;
  /** Request one admin path and decode its JSON object body. */
  private request;
  /** The account pool overview. */
  overview(): Promise<PanelOverview>;
  /** The live model catalog (each entry's id is already realm-prefixed). */
  models(): Promise<PanelModel[]>;
  /** The panel configuration document, plus the hidden-model list it carries. */
  config(): Promise<PanelConfigDocument>;
  /** Save a whole configuration document (the panel validates and hot-applies it). */
  saveConfig(config: Record<string, unknown>): Promise<PanelWriteResult>;
  /** Replace the panel's hidden-model list, preserving every other field. */
  saveHidden(hidden: readonly string[]): Promise<PanelWriteResult>;
  /** Begin an OAuth account add; returns the URL the user opens. */
  loginStart(realm: 'cn' | 'global'): Promise<{
    url: string;
    state: string;
    realm: string;
  }>;
  /** Poll one in-flight add. */
  loginPoll(state: string): Promise<PanelLoginPoll>;
  /** The session→account bindings; empty when the kernel keeps none. */
  /** Session-scoped spend, read from the kernel's own ledger. */
  sessionCredits(key: string): Promise<PanelSessionCredits>;
  sessionBindings(): Promise<PanelBinding[]>;
  /** Pin one session key to one account; answers with the new binding list. */
  bindSession(key: string, uid: string): Promise<PanelBinding[]>;
  /** Release one session key so the pool allocates it again. */
  unbindSession(key: string): Promise<PanelBinding[]>;
  /** Login regions the panel offers for the international realm. */
  regions(): Promise<readonly {
    code: string;
    name: string;
  }[]>;
  /** One per-account operation. */
  accountOp(uid: string, op: AccountOp): Promise<PanelWriteResult>;
  /** Bulk operation across every account. */
  bulkOp(op: BulkOp): Promise<PanelWriteResult>;
  /** Import accounts in the cockpit export shape (`uid`/`access_token`/`refresh_token`). */
  importAccounts(accounts: readonly Record<string, unknown>[]): Promise<PanelWriteResult & {
    imported?: number;
    skipped?: number;
    errors?: readonly string[];
  }>;
}
/** Per-account operations the panel exposes. */
type AccountOp = 'revive' | 'disable' | 'pause' | 'resume' | 'checkin' | 'balance' | 'remove';
/** Pool-wide operations the panel exposes. */
type BulkOp = 'checkin_all' | 'balance_all' | 'keepalive_all' | 'travel_all' | 'activity_all' | 'compensation_all';
/** Reasoning levels pi-ai can express, in display order. */
declare const THINKING_LEVELS: readonly ["off", "low", "medium", "high", "xhigh", "max"];
/** One reasoning level name. */
type ThinkingLevel = typeof THINKING_LEVELS[number];
/** Whether a value is a level this plugin can offer. */
declare function isThinkingLevel(value: unknown): value is ThinkingLevel;
/** The local document's per-model entry. */
interface ModelOverride {
  /** Whether the model appears in DSH's picker. Absent means enabled. */
  enabled?: boolean;
  /** The level this model should run at when a request names none. */
  effort?: ThinkingLevel;
  /**
   * The levels the picker may offer. Absent means "every level the panel
   * declares"; an empty list is treated as absent rather than as "none", since a
   * model with no selectable level cannot be pinned to one.
   */
  efforts?: readonly ThinkingLevel[];
}
/** Which WorkBuddy gateway a model id belongs to. */
type ModelRegion = 'cn' | 'global';
/** One model after the override layer is applied. */
interface CatalogModel {
  id: string;
  name: string;
  /** Gateway realm this model is served by. */
  region: ModelRegion;
  description?: string;
  vendor?: string;
  credits?: string;
  contextLength: number;
  maxOutputTokens: number;
  /** Levels the panel declares for this model, plus `off` when it can disable thinking. */
  declaredEfforts: readonly ThinkingLevel[];
  /** Levels actually offered to the picker (the override's subset, or the declared set). */
  efforts: readonly ThinkingLevel[];
  /** Level used when a request does not name one. */
  defaultEffort?: ThinkingLevel;
  canDisableThinking: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  onlyReasoning: boolean;
  tags: readonly string[];
  /** Whether the picker lists it. */
  enabled: boolean;
}
/**
 * Merge the panel catalog with the local override document.
 *
 * A model with no override is enabled and runs at the panel's own default, so a
 * fresh install — and every model the panel adds later — needs no local entry to
 * appear. An override naming a level the panel no longer declares is ignored
 * rather than obeyed: the panel is the capability authority, and pinning a level
 * a model cannot accept would fail every request.
 */
declare function buildCatalog(models: readonly PanelModel[], overrides: Readonly<Record<string, ModelOverride>>): CatalogModel[];
/** Ids the user has hidden locally — what the picker filters out. */
declare function hiddenIds(catalog: readonly CatalogModel[]): string[];
/** Every id the picker should list. */
declare function visibleIds(catalog: readonly CatalogModel[]): string[];
/**
 * The panel `models.hidden` list this plugin should push, given a catalog.
 *
 * The panel's own hidden list is an *authoritative reject* at the gateway, so it
 * is derived from the local enabled set alone. The plugin keeps the union with
 * whatever the panel hid for its own reasons: this document is the one place
 * that might also carry an operator's hand-edit, and silently un-hiding a model
 * somebody else disabled is worse than a slightly stale entry.
 */
declare function panelHiddenList(catalog: readonly CatalogModel[], previous: readonly string[]): string[];
/** The overrides document, read and written through the shared atomic store. */
declare class ModelOverridesStore {
  private readonly path;
  constructor(path?: string);
  /** Every stored override, keyed by model id. */
  all(): Record<string, ModelOverride>;
  /** One model's override, when it has one. */
  get(id: string): ModelOverride | undefined;
  /**
   * Apply a patch to one model.
   *
   * `enabled: true`, `effort: undefined` and `efforts: []` all mean "back to the
   * panel's answer": the entry is pruned instead of stored, so the document only
   * ever holds facts that differ from the panel. That keeps a later panel change
   * (a new default level, a removed capability) visible instead of masked by a
   * stale local copy.
   */
  set(id: string, patch: {
    enabled?: boolean;
    effort?: ThinkingLevel | null;
    efforts?: readonly ThinkingLevel[];
  }): ModelOverride | undefined;
  /** Enable or hide every model the catalog currently lists. */
  setAll(catalog: readonly {
    id: string;
  }[], enabled: boolean): void;
  /** Replace the whole document (used by tests and by a reset action). */
  write(models: Record<string, ModelOverride>): void;
}
/**
 * Connection settings written by the settings page: where the panel lives, the
 * key to reach it, how often to re-read it, and whether a local hide is also
 * pushed to the panel's own `models.hidden` list.
 *
 * Separate from the Cordis composition config on purpose. The composition fields
 * are the *defaults* an install ships; this document is what the user changed,
 * and it is read on every use so a save takes effect on the next poll rather
 * than at the next restart — the same live-read policy the reference plugins use
 * for their volatile fields, without needing the host's settings write seam.
 *
 * @module dsh-workbuddy2api-connect/settings-store
 */
/** The effective connection policy. */
interface ConnectionSettings {
  /** Panel origin, normalized (no trailing slash, no `/v1`). */
  panelUrl: string;
  /** Panel `api_key`; empty when the panel runs without auth. */
  apiKey: string;
  /** Poll interval in seconds (10–600). */
  refreshSeconds: number;
  /** Whether a locally hidden model is also hidden at the panel. */
  syncHiddenToPanel: boolean;
}
/** The defaults an install ships. */
declare const DEFAULT_CONNECTION: ConnectionSettings;
/** Clamp a poll interval into the range the surfaces tolerate. */
declare function clampRefreshSeconds(value: number): number;
/** Read/patch the connection document. */
declare class ConnectionStore {
  private readonly path;
  private readonly defaults;
  constructor(path?: string, defaults?: ConnectionSettings);
  /** The stored document layered over the install defaults. */
  current(): ConnectionSettings;
  /** Merge a patch into the stored document. */
  patch(patch: Partial<ConnectionSettings>): ConnectionSettings;
}
/** One account as the browser sees it. */
interface WebAccount {
  uid: string;
  nickname: string;
  realm: string;
  credits?: number;
  creditsTotal?: number;
  earliestExpiry?: string;
  status: 'active' | 'disabled' | 'paused' | 'cooling';
  coolingUntil?: string;
  disabledReason?: string;
  tokenExpiresAt?: string;
  hasRefreshToken: boolean;
  checkinDone: boolean;
  successCount: number;
  failStreak: number;
  lastSuccess?: string;
  lastModel?: string;
  requestCount?: number;
  totalTokens?: number;
  rateLimitedModels: number;
  enterprise: boolean;
}
/** One model as the browser sees it. */
interface WebModel {
  id: string;
  name: string;
  /** Gateway realm, so the page can group domestic and international rows. */
  region: 'cn' | 'global';
  description?: string;
  vendor?: string;
  credits?: string;
  contextLength: number;
  maxOutputTokens: number;
  efforts: readonly string[];
  defaultEffort?: string;
  enabled: boolean;
  canDisableThinking: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  onlyReasoning: boolean;
  tags: readonly string[];
}
/** The account-add flow in flight, when there is one. */
interface WebLogin {
  state: string;
  url: string;
  realm: string;
  startedAt: string;
}
/** The last completed account add, so the dialog can close on success. */
interface WebLoginDone {
  at: string;
  realm: string;
  uid?: string;
  nickname?: string;
}
/** What one poll changed about the catalog. */
interface WebSync {
  lastSyncedAt?: string;
  added: readonly string[];
  removed: readonly string[];
  changed: readonly string[];
  /** Whether a new model joins the DSH picker without asking. */
  autoRegister: boolean;
}
/** One provider route's ownership, as the host resolved it. */
interface ProviderRouteState {
  id: string;
  owned: boolean;
  conflict?: string;
}
/** Everything the browser surfaces render. */
/** One session→account binding, as the browser reads it. */
interface WebSessionBinding {
  key: string;
  uid: string;
  lastActive?: string;
}
/**
 * Session-level account binding support.
 *
 * "supported" is absent until a read has an opinion: a kernel that predates the
 * patch answers 404, and the chip says so instead of offering a button that
 * cannot work.
 */
interface WebSessions {
  supported?: boolean;
  bindings: readonly WebSessionBinding[];
  /**
   * The account the user last picked by hand, per realm. A new conversation has
   * no binding of its own, so the chip re-creates the pin from here; deleting
   * the plugin's `account-defaults.json` returns it to pool allocation.
   */
  defaults: {
    cn?: string;
    global?: string;
  };
  error?: string;
}
interface WebStatus {
  ok: true;
  version: string;
  /** The pi-ai copy this plugin loaded, for cross-generation support reports. */
  piAiVersion?: string;
  provider: ProviderRouteState & {
    global: ProviderRouteState;
  };
  connection: {
    panelUrl: string;
    hasApiKey: boolean;
    refreshSeconds: number;
    syncHiddenToPanel: boolean;
    autoRegister: boolean;
  };
  /** The host-owned process. */
  gateway: GatewayStatus;
  /** The separately downloaded server artifact. */
  server: ServerStatus;
  /** Kernel discovery: cadence, last check, and the version the channel offers. */
  kernel: KernelUpdateStatus;
  /**
   * The device id and token this machine's WorkBuddy client produced.
   *
   * The kernel cannot invent either, so the page reports what was actually read
   * and, when nothing was, why the client could not supply it.
   */
  deviceSignals: DeviceSignalStatus;
  panel: {
    connected: boolean;
    version?: string;
    uptimeSec?: number;
    redisMode?: string;
    authRequired: boolean;
    error?: string;
  };
  sync: WebSync;
  /** The browser half's own report: absent until it runs. */
  client: WebClientProbe;
  /** The gateway's usage ledger, folded into one window. */
  usage: UsageSummary;
  /** Which account each conversation is pinned to, when the kernel keeps that. */
  sessions: WebSessions;
  counts: {
    total: number;
    healthy: number;
    cooling: number;
    disabled: number;
    paused: number;
    models: number;
    enabledModels: number;
    hiddenModels: number;
  };
  accounts: readonly WebAccount[];
  models: readonly WebModel[];
  updatedAt?: string;
  error?: string;
  login?: WebLogin;
  loginDone?: WebLoginDone;
}
/** Whether the browser half ever reached this host process. */
interface WebClientProbe {
  /** ISO time of the last hello the client half sent. */
  helloAt?: string;
  /** Whatever the browser reported about itself. */
  agent?: string;
}
/** One panel write's outcome, as the browser surfaces read it. */
interface ActionOutcome {
  ok: boolean;
  message?: string;
  status?: WebStatus;
  /** Present on `session-credits`: this session's spend as the kernel accounts it. */
  credits?: PanelSessionCredits;
}
/** Dependencies the service reads. */
interface WorkBuddy2ApiServiceOptions {
  version: string;
  /** Resolved `@earendil-works/pi-ai` version; read once at startup. */
  piAiVersion?: string;
  providerId: string;
  providerOwned: boolean;
  conflictWith?: string;
  /** International route; defaults to `<providerId>-global`. */
  globalProviderId?: string;
  globalProviderOwned?: boolean;
  globalConflictWith?: string;
  connection: ConnectionStore;
  overrides: ModelOverridesStore;
  client: PanelClient;
  /** Resolve the host row lazily: either row may load first. */
  host: () => GatewayHost | undefined;
  cachePath?: string;
  warn?: (message: string, error?: unknown) => void;
  onChange?: () => void;
}
/**
 * The plugin's one mutable state holder.
 *
 * Reads are serialized: two surfaces polling at once share one panel request
 * instead of racing two, which matters because a write can land between them and
 * a racing read would publish the pre-write overview as if it were current.
 */
declare class WorkBuddy2ApiService {
  private readonly options;
  private snapshot;
  private catalog;
  private sync;
  private login?;
  private loginDone?;
  private loginStartedAt?;
  private clientProbe;
  private usageCache?;
  private inFlight?;
  /** Whether the last gateway read actually reached it. */
  private lastReadOk;
  /** Session to account bindings last read from the kernel, if it has them. */
  private sessions;
  /** True once the kernel answered, false when it refused the route, absent before the first read. */
  private sessionsSupported?;
  private sessionsError?;
  /** The account the user picked by hand; survives restarts and applies to new sessions. */
  private defaults;
  private emptyModelReads;
  /** Consecutive reads that omitted a realm, keyed by realm. */
  private realmGaps;
  private disposed;
  /** Provider ownership, refreshed once the llm service resolves both routes. */
  private routes;
  constructor(options: WorkBuddy2ApiServiceOptions);
  /** Publish the routes the host actually allowed after adapter registration. */
  setProviderRoutes(cn: ProviderRouteState, global: ProviderRouteState): void;
  /** The cache document this plugin writes. */
  private get cachePath();
  /** Load the last catalog so a cold boot has models before the first poll. */
  private restore;
  /** Persist the catalog for the next boot. */
  private persist;
  /** The merged catalog, for the route's descriptors. */
  catalogModels(): readonly CatalogModel[];
  /** The host row, resolved at call time so a reload cannot pin a dead one. */
  private host;
  /** Read the gateway once and fold the answer into the snapshot. */
  refresh(): Promise<void>;
  /** The read itself, kept separate so refresh can serialize it. */
  private read;
  /** Diff the gateway's catalog against ours and publish the difference. */
  private merge;
  /** Realms the previous catalog knew and this read did not mention at all. */
  private realmsMissingFrom;
  /**
   * Record that the browser half ran.
   *
   * The one fact a host process cannot otherwise see: whether the client bundle
   * was loaded and its apply executed. When the settings page is missing from the
   * navigation, this timestamp separates "never ran" from "ran and failed".
   */
  noteClientHello(agent?: string): void;
  /** Turn auto-registration on or off, and re-read so the catalog follows. */
  setAutoRegister(enabled: boolean): Promise<ActionOutcome>;
  /** The whole status document. */
  status(): WebStatus;
  /**
   * Make sure a caller that arrives early still sees data.
   *
   * The poller runs on a schedule, so the first surface to open can land between
   * two reads and stare at an empty document for a whole interval. This awaits
   * one read, but only briefly: a slow gateway costs a short wait, never a hang.
   */
  warm(withinMs?: number): Promise<void>;
  /** Re-read after a write so the answer carries the post-write world. */
  private settled;
  /** Save the connection document (address, key, cadence, sync policy). */
  saveConnection(patch: Partial<ConnectionSettings>): Promise<ActionOutcome>;
  /** Start the host-owned gateway. */
  startGateway(): Promise<ActionOutcome>;
  /** Stop the host-owned gateway (refused for one the row did not start). */
  stopGateway(): Promise<ActionOutcome>;
  /** Restart the host-owned gateway. */
  restartGateway(): Promise<ActionOutcome>;
  /** Start the pinned server download; progress is read from status(). */
  downloadServer(): Promise<ActionOutcome>;
  /** Abort the in-flight server download. */
  cancelServerDownload(): Promise<ActionOutcome>;
  /** Re-hash the installed server binary. */
  verifyServer(): Promise<ActionOutcome>;
  /** Ask the release channel for a newer kernel. */
  checkKernelUpdate(): Promise<ActionOutcome>;
  /** Install the version the last check discovered. */
  installKernelUpdate(): Promise<ActionOutcome>;
  /** Persist the automatic check cadence. */
  setKernelCadence(cadence: KernelCheckCadence): ActionOutcome;
  /**
   * Re-read the device id and mint a fresh device token.
   *
   * Minting needs the client's native library, which only the host row may load,
   * so this is an action rather than something the poller does.
   */
  refreshDeviceSignals(): Promise<ActionOutcome>;
  /** Probe the gateway without changing the process. */
  testConnection(): Promise<ActionOutcome>;
  /** Enable or disable one model in the picker, and/or pin its reasoning level. */
  setModel(patch: {
    id: string;
    enabled?: boolean;
    effort?: ThinkingLevel | null;
    efforts?: readonly ThinkingLevel[];
  }): Promise<ActionOutcome>;
  /** Enable or disable every model, or one realm's models, at once. */
  setAllModels(enabled: boolean, region?: 'cn' | 'global'): Promise<ActionOutcome>;
  /** Write the locally hidden models into the gateway's own hidden list. */
  syncHidden(): Promise<ActionOutcome>;
  /** Begin an account add; the gateway owns the OAuth flow. */
  loginStart(realm: 'cn' | 'global'): Promise<ActionOutcome>;
  /** Poll one in-flight add; a finished add becomes a real account. */
  loginPoll(state: string): Promise<ActionOutcome>;
  /** Forget the in-flight add. */
  loginCancel(): Promise<ActionOutcome>;
  /** Forget an add that has been pending far too long. */
  expireLogin(now?: number): boolean;
  /** One per-account operation. */
  accountOp(uid: string, op: AccountOp): Promise<ActionOutcome>;
  /**
   * Fold the binding read into state without ever failing the overview.
   *
   * A kernel without the endpoints answers 404 and is remembered, so the chip
   * can say "needs a newer kernel" once instead of probing a dead route on
   * every poll. Any other failure is reported but keeps the last list.
   */
  private noteBindings;
  /** The realm an account belongs to, read from the last overview. */
  private realmOfAccount;
  /** Persist one manual pick as the realm's default. */
  private rememberPick;
  /** Drop the realm's default, so new sessions go back to pool allocation. */
  private forgetPick;
  /** Pin one session key to one account: the pool stops rotating that session. */
  bindSession(key: string, uid: string): Promise<ActionOutcome>;
  /** Read one session's spend from the kernel's ledger (upstream `usage.credit`). */
  sessionCredits(key: string): Promise<ActionOutcome>;
  /** Release one session key back to the pool's own allocation. */
  unbindSession(key: string): Promise<ActionOutcome>;
  /** One pool-wide operation. */
  bulkOp(op: BulkOp): Promise<ActionOutcome>;
  /** Import accounts from the cockpit export shape. */
  importAccounts(payload: string): Promise<ActionOutcome>;
  /**
   * The usage window, re-read at most once a second.
   *
   * The ledger is rewritten on every request; reading it on each status call
   * would put a JSON parse on the polling path of every surface, and caching for
   * a second keeps the heat map live without making the page expensive.
   */
  usage(now?: number): UsageSummary;
  /** Whether the service was torn down (the host uses this to skip a late write). */
  get closed(): boolean;
  /** Stop every timer this service owns. */
  dispose(): void;
}
/** Provider route this bundle owns by default. */
declare const WORKBUDDY2API_PROVIDER = "workbuddy2api";
/** Constructor dependencies. */
interface WorkBuddy2ApiAdapterOptions {
  /** Domestic provider route; defaults to {@link WORKBUDDY2API_PROVIDER}. */
  providerId?: string;
  /** International provider route; defaults to `<providerId>-global`. */
  globalProviderId?: string;
  /** Base name the picker shows; the two groups append ` · CN` / ` · Global`. */
  displayName?: string;
  /** Override for the international group's display name. */
  globalDisplayName?: string;
  /** Live catalog read; called on every listing and resolution. */
  catalog: () => readonly CatalogModel[];
  /** The panel's `/v1` origin, re-read per request so a URL change applies. */
  v1BaseUrl: () => string;
  /** The panel key sent as `Authorization: Bearer`. */
  apiKey: () => string;
  /** Model ids the local overrides hide from the picker. */
  hidden: () => readonly string[];
  /**
   * Rebuild the host-side adapter snapshot after a catalog change.
   *
   * `PiAiAdapter` memoizes one `Models` collection per profile map identity, so
   * a route whose model list grew can keep answering `UNKNOWN_MODEL` until the
   * map is replaced. The service calls this whenever its diff finds a change.
   */
  invalidate?: () => void;
  /**
   * The host's durable attachment service, read per request.
   *
   * pi-ai refuses to build a request that still carries an image when this
   * resolves to `undefined` (`UNSUPPORTED_CONTENT`: "pi-ai image input requires
   * the durable attachment service"), so a route that admits image input has to
   * forward the host's store instead of leaving it unset.
   */
  attachments?: () => AttachmentStore | undefined;
  /** Bridge one durable reference into the current tool execution world. */
  imageAccess?: (attachments: AttachmentStore, ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined;
}
/** One provider group the adapter registers with the host. */
interface WorkBuddy2ApiProvider {
  id: string;
  displayName: string;
  region: ModelRegion;
}
/** What {@link createWorkBuddy2ApiAdapter} hands back. */
interface WorkBuddy2ApiAdapter {
  adapter: PiAiAdapter;
  /** The two picker groups, domestic first. */
  providers: readonly WorkBuddy2ApiProvider[];
  /** Announce a catalog change so the pickers re-read their lists. */
  invalidate: () => void;
}
/**
 * Assemble the route.
 *
 * The provider's `getModels` and every descriptor's `baseUrl` are read live, so
 * a URL or key change reaches the next request without rebuilding anything. The
 * profile is constructed by hand because `dsh-llm-pi-ai`'s own `resolveProfiles`
 * is not part of its public export surface; every newly required field has to be
 * adopted here explicitly.
 */
declare function createWorkBuddy2ApiAdapter(options: WorkBuddy2ApiAdapterOptions): WorkBuddy2ApiAdapter;
/** Status document path. */
declare const STATUS_PATH = "/plugins/workbuddy2api-gateway/status";
/** Action endpoint path. */
declare const ACTION_PATH = "/plugins/workbuddy2api-gateway/action";
/** Everything the page may ask the host to do. */
type GatewayAction = {
  action: 'refresh';
} | {
  action: 'test-connection';
} | {
  action: 'gateway-start';
} | {
  action: 'gateway-stop';
} | {
  action: 'gateway-restart';
} | {
  action: 'server-download';
} | {
  action: 'server-cancel';
} | {
  action: 'server-verify';
} | {
  action: 'kernel-check';
} | {
  action: 'kernel-install';
} | {
  action: 'kernel-cadence';
  cadence: 'hourly' | 'never';
} | {
  action: 'device-refresh';
} | {
  action: 'connection';
  panelUrl?: string;
  apiKey?: string;
  refreshSeconds?: number;
  syncHiddenToPanel?: boolean;
} | {
  action: 'auto-register';
  enabled: boolean;
} | {
  action: 'model';
  id: string;
  enabled?: boolean;
  effort?: ThinkingLevel | null;
  efforts?: readonly ThinkingLevel[];
} | {
  action: 'models-all';
  enabled: boolean;
  region?: 'cn' | 'global';
} | {
  action: 'sync-hidden';
} | {
  action: 'login-start';
  realm: 'cn' | 'global';
} | {
  action: 'login-poll';
  state: string;
} | {
  action: 'login-cancel';
} | {
  action: 'account';
  uid: string;
  op: AccountOp;
} | {
  action: 'bulk';
  op: BulkOp;
} | {
  action: 'import';
  payload: string;
} | {
  action: 'session-bind';
  session: string;
  uid: string;
} | {
  action: 'session-unbind';
  session: string;
} | {
  action: 'session-credits';
  session: string;
};
/** Parse and shape-check one action; unknown fields are ignored, not trusted. */
declare function parseAction(text: string): GatewayAction | undefined;
/** Execute one parsed action against the service. */
declare function runAction(service: WorkBuddy2ApiService, action: GatewayAction): Promise<unknown>;
/**
 * The build-stamped package version, injected by `tsdown` at build time.
 *
 * Read through this module rather than a literal so the status document, the
 * settings page's version chip, and `package.json` cannot drift apart: the define
 * map in `tsdown.config.ts` reads the same manifest field.
 *
 * @module dsh-workbuddy2api-gateway/version
 */
/** This build's version. */
declare const WORKBUDDY2API_GATEWAY_VERSION: string;
/** This plugin's data directory. */
declare function pluginDataDir(): string;
/** The supervised gateway's working directory (its auths/ and data/ live here). */
declare function gatewayWorkdir(): string;
/** The gateway's config.json path. */
/**
 * The verified server cache.
 *
 * The gateway binary is NOT shipped in this package. It lives here, under a
 * version/platform directory, after its SHA-256 matched the pinned
 * `server.json`. The host row is the only writer; the panel reads status.
 */
declare function serverRootDir(): string;
declare function gatewayConfigPath(): string;
/** The Cordis service name this plugin provides. */
declare const WORKBUDDY2API_CATALOG_SERVICE = "workbuddy2apiCatalog";
/** The contract generation consumers should compare against. */
declare const WORKBUDDY2API_CATALOG_SERVICE_VERSION = 1;
/**
 * Base unit price: credits per million tokens at a x1.0 multiplier.
 *
 * Reverse-engineered from the gateway's usage ledger (the true per-request
 * credit cost), so a consumer that multiplies by a model's multiplier lands on
 * the number the gateway actually charges. Kept here, not in the ledger config,
 * because this is the one place the panel can state it without depending on
 * cost-meter's storage.
 */
declare const UNIT_CREDIT_PRICING: {
  /** The unit the numbers are in. */
  readonly currency: "credits";
  /** All three figures are per one million tokens. */
  readonly unit: "per-million-tokens";
  /** The multiplier this base corresponds to. */
  readonly multiplier: 1;
  /** Cached (cache-hit) input tokens. */
  readonly cacheHit: 2.5972727273;
  /** Uncached (cache-miss) input tokens. */
  readonly cacheMiss: 129.9227273;
  /** Output tokens. */
  readonly output: 519.4290909;
};
/** The base unit price shape. */
type UnitCreditPricing = typeof UNIT_CREDIT_PRICING;
/** Credits per million tokens for one model. */
interface CreditPrice {
  cacheHit: number;
  cacheMiss: number;
  output: number;
}
/** One model as the catalog service exposes it: the panel row plus its price. */
interface WorkBuddyCatalogModel {
  id: string;
  name: string;
  region: 'cn' | 'global';
  description?: string;
  vendor?: string;
  /** The multiplier text the gateway advertises, e.g. `x0.17`. */
  credits?: string;
  /** The parsed multiplier, when the text carries a number. */
  creditsMultiplier?: number;
  contextLength: number;
  maxOutputTokens: number;
  efforts: readonly string[];
  defaultEffort?: string;
  enabled: boolean;
  canDisableThinking: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  onlyReasoning: boolean;
  tags: readonly string[];
  /** Credits per million tokens; absent when the model advertises no multiplier. */
  price?: CreditPrice;
}
/** The service value consumers read. */
interface WorkBuddy2ApiCatalog {
  /** Contract generation; compare against {@link WORKBUDDY2API_CATALOG_SERVICE_VERSION}. */
  readonly serviceVersion: number;
  /** Monotonic revision; bumps on every catalog change so a consumer can skip unchanged reads. */
  revision(): number;
  /** The live catalog, priced. A fresh snapshot on each call. */
  models(): readonly WorkBuddyCatalogModel[];
  /** One model by id, or undefined when the gateway does not list it. */
  model(id: string): WorkBuddyCatalogModel | undefined;
  /** The base unit price (multiplier 1) every model's price is derived from. */
  unitPricing(): UnitCreditPricing;
}
/**
 * Parse a gateway multiplier like `x0.17` into its number.
 *
 * Accepts a bare number too (`0.17`), since the gateway has answered both
 * shapes. A missing or unparseable value is `undefined` — "no price known" is
 * different from "price zero".
 */
declare function parseCreditsMultiplier(credits: string | undefined): number | undefined;
/** Price one model from its multiplier; undefined when the multiplier is unknown. */
declare function creditPriceOf(multiplier: number | undefined): CreditPrice | undefined;
/** Project one panel catalog row onto the service shape, adding the price. */
declare function toCatalogModel(model: CatalogModel): WorkBuddyCatalogModel;
/**
 * Build the service value.
 *
 * `source` is the panel's own `catalogModels()` reader; `revision` a closure
 * the panel bumps on every announced change. Keeping both as functions means
 * the value never pins a stale catalog — a consumer that calls `models()` after
 * a reload always sees the live one.
 */
declare function createWorkBuddy2ApiCatalog(source: () => readonly CatalogModel[], revision: () => number): WorkBuddy2ApiCatalog;
/** Stable Cordis plugin name. */
declare const name = "llm-workbuddy2api-gateway";
/** The model registry required before the route can register. */
declare const inject: string[];
/**
 * Composition defaults for the panel row.
 *
 * Process fields live in the host row (`workbuddy2api-gateway-host`) now. The
 * four deprecated fields stay accepted so an existing profile patch does not
 * fail schema validation; only `port` is still read, as the default loopback
 * address before the host service answers.
 */
declare const Config: z<Config>;
/** Parsed composition config. */
interface Config {
  providerId: string;
  displayName: string;
  port: number;
  autoStart: boolean;
  restartLimit: number;
  refreshSeconds: number;
  apiKey: string;
  authDir: string;
  autoRegister: boolean;
}
/** Wire the plugin into the host. */
declare function apply(ctx: Context, config: Config): void;
export { ACTION_PATH, type AccountOp, type ActionOutcome, type BulkOp, type CatalogModel, Config, type ConnectionSettings, ConnectionStore, type CreditPrice, DEFAULT_CONNECTION, GATEWAY_HOST_SERVICE, GATEWAY_HOST_SERVICE_VERSION, type GatewayAction, type GatewayHost, type GatewayLogLine, type GatewayState, type GatewayStatus, type ModelOverride, ModelOverridesStore, type PanelAccount, PanelClient, PanelError, type PanelModel, type PanelOverview, STATUS_PATH, type ServerDownloadState, type ServerDownloadStatus, type ServerStatus, THINKING_LEVELS, type ThinkingLevel, UNIT_CREDIT_PRICING, type UnitCreditPricing, WORKBUDDY2API_CATALOG_SERVICE, WORKBUDDY2API_CATALOG_SERVICE_VERSION, WORKBUDDY2API_GATEWAY_VERSION, WORKBUDDY2API_PROVIDER, type WebAccount, type WebLogin, type WebLoginDone, type WebModel, type WebStatus, type WebSync, type WorkBuddy2ApiCatalog, WorkBuddy2ApiService, type WorkBuddyCatalogModel, apply, buildCatalog, clampRefreshSeconds, createWorkBuddy2ApiAdapter, createWorkBuddy2ApiCatalog, creditPriceOf, gatewayConfigPath, gatewayWorkdir, hiddenIds, inject, isThinkingLevel, name, normalizePanelUrl, panelHiddenList, parseAction, parseCreditsMultiplier, pluginDataDir, runAction, safeMessage, serverRootDir, toCatalogModel, visibleIds };