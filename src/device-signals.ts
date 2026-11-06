/**
 * WorkBuddy's device signals, minted where they can be minted.
 *
 * Two values the WorkBuddy client attaches to its own requests cannot be
 * invented by a Go gateway: `qimei36`, the device id the client's telemetry SDK
 * caches on disk, and the Turing device token its native shield library signs on
 * this machine. Both are produced locally, so this row reads the first from the
 * client's cache and asks the client's own native module for the second.
 *
 * The row never imports `node:child_process`: the token comes back from a child
 * started through `ctx.subprocess`, exactly like the gateway binary. Everything
 * the kernel needs lands in two files beside the gateway's own documents, so the
 * kernel reads a path instead of reaching into the plugin:
 *
 * - `device-signals.json` — the whole answer, for the panel and for operators;
 * - `device-token.txt` — the bare token, for `upstream.device_token_file`.
 *
 * A failed mint keeps the previous token. The client itself reuses one token for
 * about five minutes, so the last value this machine produced is still the value
 * the upstream saw; serving it a little stale beats serving nothing.
 *
 * @module dsh-workbuddy2api-gateway/device-signals
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { DeviceSignalStatus } from './gateway-contract.ts'
import type { SubprocessHandleLike } from './gateway-supervisor.ts'
import { dshHome, deviceSignalsPath, deviceTokenPath } from './paths.ts'

/** Format version of the device-signals document. */
const DOCUMENT_VERSION = 1

/** The channel WorkBuddy's domestic build registers its shield with (5.9.x). */
const FALLBACK_CHANNEL_ID = 109144

/** How often the row re-mints; the client reuses a token for five minutes. */
export const DEVICE_REFRESH_MS = 60_000

/** How long the native library may take before the child is terminated. */
const MINT_TIMEOUT_MS = 20_000

/** Ceiling on the child's output, so a chatty runtime cannot flood the row. */
const MAX_STDOUT_BYTES = 64 * 1024

/** One spawn request, in the shape the host seam accepts (it also takes `env`). */
export interface DeviceSpawnSpec {
  argv: readonly string[]
  cwd: string
  stdio: {
    stdin: 'ignore'
    stdout: 'pipe'
    stderr: 'pipe'
  }
  graceMs: number
  env?: Record<string, string>
}

/** The host subprocess seam, as this row uses it. */
export interface DeviceSpawner {
  spawn(spec: DeviceSpawnSpec): SubprocessHandleLike
}

/** The install the signals are read from. */
export interface WorkBuddyInstall {
  /** The directory the client is installed in. */
  root: string
  /** The client version its own documents declare. */
  version?: string
  /** The Turing channel id the client registers with. */
  channelId: number
  /** The product name the shield expects, e.g. `WorkBuddy`. */
  productName: string
  /** The native module (or its JS wrapper) to load. */
  nativeModule: string
}

/** A node runtime, and the environment it needs to behave like one. */
interface NodeRuntime {
  path: string
  env?: Record<string, string>
}

/** One mint attempt's answer. */
type MintResult = { ok: true, token: string } | { ok: false, error: string }

/** The persisted document. */
interface DeviceSignalDocument {
  version: number
  updatedAt: string
  qimei36?: string
  deviceToken?: string
  deviceTokenAt?: string
  workbuddy?: { root: string, version?: string, channelId?: number }
}

/** What the collector reads from the host row. */
export interface DeviceSignalOptions {
  /** The host seam; the collector never spawns a process on its own. */
  subprocess(): DeviceSpawner | undefined
  /** Whether the user left the feature on. */
  enabled(): boolean
  /** An explicit install directory; empty means discover one. */
  workbuddyRoot(): string
  log?(message: string, error?: unknown): void
}

/** The script the node child runs: load the shield, ask for one token, print it. */
const TOKEN_SCRIPT = [
  "const fs = require('node:fs')",
  'const input = JSON.parse(process.argv[1])',
  'const answer = (value) => { process.stdout.write(JSON.stringify(value)) }',
  'if (!fs.existsSync(input.native)) {',
  "  answer({ ok: false, error: 'the Turing native module is missing' })",
  '} else {',
  '  try {',
  '    const sdk = require(input.native)',
  '    if (typeof sdk.configure !== "function" || typeof sdk.fetchDeviceToken !== "function") {',
  '      answer({ ok: false, error: "the Turing module does not export configure/fetchDeviceToken" })',
  '    } else {',
  '      sdk.configure(input.channelId, input.productName, input.productVersion)',
  '      Promise.resolve(sdk.fetchDeviceToken({ includesDeviceInfo: false }))',
  '        .then((result) => {',
  '          const token = typeof result === "string" ? result : result && result.token',
  '          answer(typeof token === "string" && token !== "" ? { ok: true, token } : { ok: false, error: "the Turing module returned no token" })',
  '        })',
  '        .catch((error) => { answer({ ok: false, error: String((error && error.message) || error) }) })',
  '    }',
  '  } catch (error) {',
  '    answer({ ok: false, error: String((error && error.message) || error) })',
  '  }',
  '}',
].join('\n')

/** Error → one line, for the status document. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Replace a file atomically with owner-only permissions. */
function writePrivateFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = resolve(`${path}.${randomBytes(6).toString('hex')}.tmp`)
  writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}

/** The client's own config directory (%WORKBUDDY_CONFIG_DIR%, else ~/.workbuddy). */
function workbuddyConfigDir(): string {
  const configured = process.env['WORKBUDDY_CONFIG_DIR']
  return configured !== undefined && configured.trim() !== '' ? configured : join(homedir(), '.workbuddy')
}

/** The device id the client cached, when it has one. */
function readQimei36(): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(workbuddyConfigDir(), 'qimei-cache.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const value = (parsed as Record<string, unknown>)['qimei36']
    return typeof value === 'string' && /^[0-9A-Za-z]{36}$/u.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Read one JSON document, tolerating every kind of absence. */
function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** The Turing module to load: the extracted one first, the archived one second. */
function findTuringModule(resources: string): string | undefined {
  const roots = [join(resources, 'app.asar.unpacked'), join(resources, 'app.asar')]
  for (const root of roots) {
    const candidates = [
      join(root, 'native', 'turing-sdk', 'index.cjs'),
      join(root, 'native', 'turing-sdk', 'build', 'Release', 'turing_sdk.node'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Describe one install, or reject the candidate.
 *
 * The client keeps its product document inside `cli/product.json` and its native
 * shield beside the app archive; both are needed, so a directory that has only
 * one of them is not an install.
 */
function describeInstall(candidate: string): WorkBuddyInstall | undefined {
  // macOS points at the bundle's Resources directory; Windows at the app folder.
  const resources = existsSync(join(candidate, 'app.asar')) ? candidate : join(candidate, 'resources')
  if (!existsSync(join(resources, 'app.asar'))) return undefined
  const nativeModule = findTuringModule(resources)
  if (nativeModule === undefined) return undefined
  const product = readJson(join(resources, 'app.asar', 'cli', 'product.json'))
  const turing = typeof product?.['config'] === 'object' && product['config'] !== null
    ? (product['config'] as Record<string, unknown>)['turingSdk']
    : undefined
  const channel = typeof turing === 'object' && turing !== null
    ? (turing as Record<string, unknown>)['channelId']
    : undefined
  const app = readJson(join(resources, 'app.asar', 'package.json'))
  const version = typeof product?.['genieVersion'] === 'string'
    ? product['genieVersion']
    : typeof app?.['version'] === 'string'
      ? app['version']
      : undefined
  const productName = typeof product?.['productName'] === 'string' ? product['productName'] : 'WorkBuddy'
  return {
    root: candidate,
    ...version === undefined ? {} : { version },
    channelId: typeof channel === 'number' && Number.isFinite(channel) ? channel : FALLBACK_CHANNEL_ID,
    productName,
    nativeModule,
  }
}

/** Every place a client is plausibly installed, cheapest first. */
function installCandidates(override: string): string[] {
  const candidates: string[] = []
  if (override.trim() !== '') candidates.push(override.trim())
  for (const name of ['WORKBUDDY_HOME', 'WORKBUDDY_INSTALL_DIR', 'WORKBUDDY_ROOT']) {
    const value = process.env[name]
    if (value !== undefined && value.trim() !== '') candidates.push(value.trim())
  }
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA']
    if (local !== undefined && local !== '') {
      candidates.push(join(local, 'Programs', 'WorkBuddy'), join(local, 'WorkBuddy'))
    }
    for (const name of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
      const base = process.env[name]
      if (base !== undefined && base !== '') candidates.push(join(base, 'WorkBuddy'))
    }
    // A portable install lands anywhere; the common vendor folders are cheap probes.
    for (const drive of ['C:', 'D:', 'E:', 'F:']) {
      for (const sub of ['Software', 'Apps', 'Tools', 'Program Files']) {
        candidates.push(join(drive + '\\', sub, 'WorkBuddy'))
      }
    }
  } else {
    candidates.push('/Applications/WorkBuddy.app/Contents/Resources')
    candidates.push(join(homedir(), 'Applications', 'WorkBuddy.app', 'Contents', 'Resources'))
  }
  return candidates
}

/** Find the first candidate that is really an install. */
export function findWorkBuddy(override: string): WorkBuddyInstall | undefined {
  for (const candidate of installCandidates(override)) {
    const install = describeInstall(candidate)
    if (install !== undefined) return install
  }
  return undefined
}

/**
 * A node that can load the shield.
 *
 * The harness ships its own runtimes, so the first one found is used; the host
 * executable is the fallback with `ELECTRON_RUN_AS_NODE`, which turns the same
 * binary into a plain node. A bare `node` from PATH is never assumed: the row
 * runs on machines that have none.
 */
function findNodeRuntime(): NodeRuntime | undefined {
  const runtimes = join(dshHome(), 'dsh-runtimes')
  const binary = process.platform === 'win32' ? 'node.exe' : 'node'
  try {
    for (const entry of readdirSync(runtimes, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(runtimes, entry.name, 'dependencies', 'node', 'bin', binary)
      if (existsSync(candidate)) return { path: candidate }
    }
  } catch {
    // No runtime directory: the host executable still works.
  }
  const host = process.execPath
  if (host === undefined || host === '') return undefined
  const name = host.split(/[\\/]/u).pop() ?? ''
  if (name === 'node' || name === 'node.exe') return { path: host }
  return { path: host, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** One line of output is the answer; anything else is noise from the runtime. */
function parseAnswer(text: string): MintResult {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined) continue
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    const parsed = readJsonFromText(trimmed)
    if (parsed === undefined) continue
    const token = parsed['token']
    if (parsed['ok'] === true && typeof token === 'string' && token !== '') return { ok: true, token }
    const error = parsed['error']
    return { ok: false, error: typeof error === 'string' ? error : 'the token child failed without a reason' }
  }
  return { ok: false, error: 'the token child printed no answer' }
}

/** Parse JSON already in hand. */
function readJsonFromText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** Read the document the previous row (or the previous run) left behind. */
function readDocument(): DeviceSignalDocument | undefined {
  const document = readJson(deviceSignalsPath())
  if (document === undefined || document['version'] !== DOCUMENT_VERSION) return undefined
  const qimei36 = document['qimei36']
  const deviceToken = document['deviceToken']
  const deviceTokenAt = document['deviceTokenAt']
  const updatedAt = document['updatedAt']
  const workbuddy = document['workbuddy']
  return {
    version: DOCUMENT_VERSION,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date(0).toISOString(),
    ...typeof qimei36 === 'string' ? { qimei36 } : {},
    ...typeof deviceToken === 'string' ? { deviceToken } : {},
    ...typeof deviceTokenAt === 'string' ? { deviceTokenAt } : {},
    ...typeof workbuddy === 'object' && workbuddy !== null
      ? {
          workbuddy: {
            root: String((workbuddy as Record<string, unknown>)['root'] ?? ''),
            ...typeof (workbuddy as Record<string, unknown>)['version'] === 'string'
              ? { version: String((workbuddy as Record<string, unknown>)['version']) }
              : {},
            ...typeof (workbuddy as Record<string, unknown>)['channelId'] === 'number'
              ? { channelId: Number((workbuddy as Record<string, unknown>)['channelId']) }
              : {},
          },
        }
      : {},
  }
}

/**
 * The device-signal collector.
 *
 * It owns no timer: the host row decides when to call {@link refresh}, so the
 * cadence stays one visible number in one place.
 */
export class DeviceSignalCollector {
  private readonly options: DeviceSignalOptions
  private document?: DeviceSignalDocument
  private lastRunAt?: string
  private lastError?: string
  private running?: Promise<DeviceSignalStatus>

  constructor(options: DeviceSignalOptions) {
    this.options = options
    this.document = readDocument()
    this.lastRunAt = this.document?.updatedAt
  }

  /** What the panel and the kernel see. */
  status(): DeviceSignalStatus {
    const document = this.document
    const workbuddy = document?.workbuddy
    return {
      enabled: this.options.enabled(),
      ...workbuddy?.root === undefined || workbuddy.root === '' ? {} : { workbuddyRoot: workbuddy.root },
      ...workbuddy?.version === undefined ? {} : { workbuddyVersion: workbuddy.version },
      ...document?.qimei36 === undefined ? {} : { qimei36: document.qimei36 },
      hasToken: document?.deviceToken !== undefined,
      ...document?.deviceTokenAt === undefined ? {} : { tokenAt: document.deviceTokenAt },
      ...this.lastRunAt === undefined ? {} : { refreshedAt: this.lastRunAt },
      path: deviceSignalsPath(),
      tokenPath: deviceTokenPath(),
      ...this.lastError === undefined ? {} : { error: this.lastError },
    }
  }

  /**
   * Read the device id and mint a token, then persist both.
   *
   * Concurrent callers share one run: the panel's refresh button and the row's
   * timer must not start two children.
   */
  refresh(): Promise<DeviceSignalStatus> {
    const running = this.running
    if (running !== undefined) return running
    const run = this.collect().catch((error: unknown) => {
      this.fail(new Date().toISOString(), messageOf(error))
      return this.status()
    }).finally(() => {
      this.running = undefined
    })
    this.running = run
    return run
  }

  /** Forget nothing but the reason: a mint that works clears the last error. */
  private async collect(): Promise<DeviceSignalStatus> {
    const runAt = new Date().toISOString()
    if (!this.options.enabled()) {
      this.fail(runAt, 'device signals are switched off in the host row configuration')
      return this.status()
    }
    const qimei36 = readQimei36()
    const install = findWorkBuddy(this.options.workbuddyRoot())
    if (install === undefined) {
      this.fail(runAt, 'no WorkBuddy client was found; install it and start it once')
      return this.status()
    }
    const minted = await this.mint(install)
    const previous = this.document
    const token = minted.ok ? minted.token : previous?.deviceToken
    const tokenAt = minted.ok ? runAt : previous?.deviceTokenAt
    const qimei = qimei36 ?? previous?.qimei36
    this.document = {
      version: DOCUMENT_VERSION,
      updatedAt: runAt,
      ...qimei === undefined ? {} : { qimei36: qimei },
      ...token === undefined ? {} : { deviceToken: token },
      ...tokenAt === undefined ? {} : { deviceTokenAt: tokenAt },
      workbuddy: {
        root: install.root,
        ...install.version === undefined ? {} : { version: install.version },
        channelId: install.channelId,
      },
    }
    this.lastRunAt = runAt
    this.lastError = minted.ok
      ? qimei === undefined
        ? 'the client has no device id cached yet; start it once so it writes one'
        : undefined
      : minted.error
    if (!minted.ok) this.options.log?.('workbuddy2api-gateway-host: device token mint failed', minted.error)
    this.persist()
    return this.status()
  }

  /** Run the client's own shield in a child and read the token back. */
  private async mint(install: WorkBuddyInstall): Promise<MintResult> {
    const spawner = this.options.subprocess()
    if (spawner === undefined) return { ok: false, error: 'the host subprocess seam is not available yet' }
    const runtime = findNodeRuntime()
    if (runtime === undefined) return { ok: false, error: 'no node runtime was found to load the Turing shield' }
    const input = JSON.stringify({
      native: install.nativeModule,
      channelId: install.channelId,
      productName: install.productName,
      productVersion: install.version ?? '0.0.0',
    })
    let handle: SubprocessHandleLike
    try {
      handle = spawner.spawn({
        argv: [runtime.path, '-e', TOKEN_SCRIPT, input],
        cwd: dirname(install.nativeModule),
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 2_000,
        ...runtime.env === undefined ? {} : { env: runtime.env },
      })
    } catch (error: unknown) {
      return { ok: false, error: 'could not start the token child: ' + messageOf(error) }
    }
    let stdout = ''
    let stderr = ''
    handle.stdout?.on('data', (chunk: Buffer | string) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += String(chunk)
    })
    handle.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < MAX_STDOUT_BYTES) stderr += String(chunk)
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      handle.terminate()
    }, MINT_TIMEOUT_MS)
    timer.unref?.()
    try {
      await handle.done
    } catch (error: unknown) {
      return { ok: false, error: 'the token child failed: ' + messageOf(error) }
    } finally {
      clearTimeout(timer)
    }
    if (timedOut) return { ok: false, error: 'the Turing shield did not answer within ' + String(MINT_TIMEOUT_MS) + 'ms' }
    const answer = parseAnswer(stdout)
    if (answer.ok) return answer
    const detail = stderr.trim()
    return { ok: false, error: detail === '' ? answer.error : answer.error + ' (' + detail.slice(0, 200) + ')' }
  }

  /** Record a failed run without touching the token already on disk. */
  private fail(at: string, error: string): void {
    this.lastRunAt = at
    this.lastError = error
    this.options.log?.('workbuddy2api-gateway-host: device signals unavailable', error)
    this.persist()
  }

  /** Write the two documents the kernel reads. A failed write stays in memory. */
  private persist(): void {
    const document = this.document
    if (document === undefined) return
    try {
      writePrivateFile(deviceSignalsPath(), `${JSON.stringify(document, null, 2)}\n`)
      // The bare token file is what `upstream.device_token_file` reads: one value,
      // no JSON, so the kernel needs no parser for it.
      if (document.deviceToken !== undefined) writePrivateFile(deviceTokenPath(), document.deviceToken)
    } catch (error: unknown) {
      this.options.log?.('workbuddy2api-gateway-host: could not write the device-signal documents', error)
    }
  }
}
