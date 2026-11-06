/**
 * The device-signal collector, end to end against a fake install.
 *
 * The point of the collector is that it runs the client's own native module in a
 * child and keeps whatever that child says; the test therefore stands up a
 * directory shaped like an install, gives the row a spawner that really starts a
 * process, and reads back the two documents the kernel will read.
 */
import { spawn as spawnProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DeviceSignalCollector } from '../src/device-signals.ts'
import type { DeviceSpawnSpec, DeviceSpawner } from '../src/device-signals.ts'

const QIMEI = '3c8467322d5d6cda3e95456d300012b1aa18'
const roots: string[] = []
let home = ''
let install = ''
const savedEnv: Record<string, string | undefined> = {}

/** A directory under the test's own temp root. */
function tempDir(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** The module the fake install exposes: one function the collector's script calls. */
function writeShield(body: string): void {
  writeFileSync(
    join(install, 'app.asar', 'native', 'turing-sdk', 'index.cjs'),
    'module.exports = { configure: () => {}, fetchDeviceToken: () => (' + body + ') }\n',
    'utf8',
  )
}

/** Spawn a real child, in the shape the host seam hands back. */
const spawner: DeviceSpawner = {
  spawn: (spec: DeviceSpawnSpec) => {
    const child = spawnProcess(spec.argv[0] as string, spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const done = new Promise<{ exitCode: number | null, signal: string | null }>(resolve => {
      child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
    })
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      done,
      terminate: () => { child.kill('SIGTERM') },
      waitForExit: () => done,
    }
  },
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'wb2a-device-signals-'))
  roots.push(home)
  savedEnv['DSH_HOME'] = process.env['DSH_HOME']
  savedEnv['WORKBUDDY_CONFIG_DIR'] = process.env['WORKBUDDY_CONFIG_DIR']
  process.env['DSH_HOME'] = home
  // The device id lives in the client's own config directory, not the harness's.
  const clientConfig = tempDir('client-config')
  process.env['WORKBUDDY_CONFIG_DIR'] = clientConfig
  writeFileSync(join(clientConfig, 'qimei-cache.json'), JSON.stringify({ qimei36: QIMEI }), 'utf8')

  install = tempDir('install')
  mkdirSync(join(install, 'app.asar', 'cli'), { recursive: true })
  mkdirSync(join(install, 'app.asar', 'native', 'turing-sdk'), { recursive: true })
  writeFileSync(
    join(install, 'app.asar', 'cli', 'product.json'),
    JSON.stringify({ productName: 'WorkBuddy', genieVersion: '5.9.3', config: { turingSdk: { channelId: 109144 } } }),
    'utf8',
  )
})

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A collector pointed at the fake install, with nothing read yet. */
function collector(options: { enabled?: boolean, root?: string } = {}): DeviceSignalCollector {
  return new DeviceSignalCollector({
    subprocess: () => spawner,
    enabled: () => options.enabled ?? true,
    workbuddyRoot: () => options.root ?? install,
  })
}

describe('device signals', () => {
  it('reads the cached device id and mints a token through the client\'s own module', async () => {
    writeShield('{ token: \'tok-1\' }')
    const signals = collector()
    const status = await signals.refresh()
    expect(status.error).toBeUndefined()
    expect(status.workbuddyRoot).toBe(install)
    expect(status.workbuddyVersion).toBe('5.9.3')
    expect(status.qimei36).toBe(QIMEI)
    expect(status.hasToken).toBe(true)
    // Both documents land where the kernel looks: one JSON, one bare token.
    expect(JSON.parse(readFileSync(status.path, 'utf8'))).toMatchObject({ version: 1, qimei36: QIMEI, deviceToken: 'tok-1' })
    expect(readFileSync(status.tokenPath, 'utf8')).toBe('tok-1')
  })

  it('keeps the last token when a mint fails, and says why', async () => {
    writeShield('{ }')
    const signals = collector()
    const status = await signals.refresh()
    expect(status.hasToken).toBe(true)
    expect(status.error).toBe('the Turing module returned no token')
    expect(readFileSync(status.tokenPath, 'utf8')).toBe('tok-1')
  })

  // A hint that names no client must not stop discovery: a user who points the
  // setting at the wrong folder should still get signals from a real install,
  // and a machine with no install at all should get one readable reason.
  it('walks past a hint that names no client', async () => {
    writeShield("{ token: 'tok-3' }")
    const bogus = tempDir('not-a-client')
    const status = await collector({ root: bogus }).refresh()
    expect(status.workbuddyRoot).not.toBe(bogus)
    if (status.workbuddyRoot === undefined) expect(status.error).toContain('no WorkBuddy client')
  })

  it('claims nothing when the feature is switched off', async () => {
    const signals = collector({ enabled: false })
    const status = await signals.refresh()
    expect(status.enabled).toBe(false)
    expect(status.error).toContain('switched off')
  })
})
