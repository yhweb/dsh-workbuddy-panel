#!/usr/bin/env node
/**
 * Build the separately distributed server release.
 *
 * The panel package never contains this binary. This script cross-compiles the
 * upstream snapshot for the supported platform matrix, gzips each result, and
 * writes the pinned `server.json` the panel reads. It is a release tool, not a
 * runtime dependency.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

// 用法：
//   node scripts/build-server-release.mjs 1.15.1-panel            # 全平台 go build
//   node scripts/build-server-release.mjs --version 1.15.1-panel \
//     --base https://github.com/<owner>/<repo>/releases/download \
//     --binary <已编译好的可执行文件> --key win32-x64              # 只打包现成二进制
const flags = {}
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const next = process.argv[i + 1]
  flags[arg.slice(2)] = next !== undefined && !next.startsWith('--') ? ((i += 1), next) : 'true'
}
const positional = process.argv[2]?.startsWith('--') ? undefined : process.argv[2]
const version = flags.version ?? positional ?? '1.14.0-panel'
const releaseBase = flags.base ?? 'https://github.com/functy23/dsh-workbuddy-panel/releases/download'
const prebuilt = flags.binary
const prebuiltKey = flags.key ?? 'win32-x64'
const source = fileURLToPath(new URL('../upstream/workbuddy2api-panel', import.meta.url))
const dist = fileURLToPath(new URL('../dist', import.meta.url))
const targets = [
  { goos: 'darwin', goarch: 'arm64', key: 'darwin-arm64', ext: '' },
  { goos: 'darwin', goarch: 'amd64', key: 'darwin-x64', ext: '' },
  { goos: 'linux', goarch: 'amd64', key: 'linux-x64', ext: '' },
  { goos: 'linux', goarch: 'arm64', key: 'linux-arm64', ext: '' },
  // 注意 goos 是 Go 的取值（windows），key 是 Node/面板侧的 platform 名（win32）；
  // 两者不同源，写成 goos:'win32' 会让 go build 直接报 unsupported GOOS/GOARCH pair。
  { goos: 'windows', goarch: 'amd64', key: 'win32-x64', ext: '.exe' },
]
if (prebuilt === undefined && !existsSync(source)) {
  console.error('missing upstream/workbuddy2api-panel')
  process.exit(1)
}
mkdirSync(dist, { recursive: true })
const assets = {}
/** 把一段可执行文件字节压成 .gz 写进 dist，并登记到 assets。 */
function pack(key, stem, bytes) {
  const compressed = gzipSync(bytes, { level: 9 })
  writeFileSync(join(dist, stem + '.gz'), compressed)
  assets[key] = {
    asset: stem + '.gz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    downloadSize: compressed.length,
  }
  console.log('packed ' + key + ' size=' + String(bytes.length) + ' sha256=' + assets[key].sha256)
}
if (prebuilt !== undefined) {
  if (!existsSync(prebuilt)) {
    console.error('missing prebuilt binary: ' + prebuilt)
    process.exit(1)
  }
  pack(prebuiltKey, 'workbuddy2api-' + version + '-' + prebuiltKey, readFileSync(prebuilt))
}
for (const target of prebuilt === undefined ? targets : []) {
  const stem = 'workbuddy2api-' + version + '-' + target.key
  const raw = join(dist, stem + target.ext)
  console.log('building ' + target.key)
  execFileSync('go', [
    'build',
    '-trimpath',
    '-ldflags',
    '-s -w',
    '-o',
    raw,
    './cmd/server',
  ], {
    cwd: source,
    stdio: 'inherit',
    env: {
      ...process.env,
      CGO_ENABLED: '0',
      GOOS: target.goos,
      GOARCH: target.goarch,
    },
  })
  pack(target.key, stem, readFileSync(raw))
}
const manifest = {
  schemaVersion: 1,
  version,
  apiVersion: 1,
  minPanel: '0.4.0',
  releaseTag: 'server-v' + version,
  releaseBaseUrl: releaseBase,
  assets,
}
const document = JSON.stringify(manifest, null, 2) + '\n'
writeFileSync(new URL('../server.json', import.meta.url), document, 'utf8')
// The release must ALSO carry the manifest as an asset: that is how the panel's
// "check for updates" discovers a newer kernel without a panel release.
writeFileSync(join(dist, 'server.json'), document, 'utf8')
console.log('wrote server.json with ' + Object.keys(assets).length + ' assets')
console.log('upload dist/server.json together with the .gz assets:')
console.log('  gh release create server-v' + version + ' dist/workbuddy2api-' + version + '-*.gz dist/server.json ...')
