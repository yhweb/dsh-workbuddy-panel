# 把 workbuddy-panel 的构建产物同步进 DSH profile
# 绕过 pnpm：profile 里 dsh-providers-hub 是无 ref 的 git 依赖，pnpm add 会报 ERR_PNPM_INVALID_VERSION_UNION
param([switch]$Build)
$ErrorActionPreference='Stop'
$src = 'E:\code\Ai_tools_plugins\dsh-workbuddy-panel'
$dst = 'D:\USER_ENV\.dsh\profiles\desktop\node_modules\dsh-workbuddy-panel'

if ($Build) {
  Write-Host '[1/3] 构建…'
  Push-Location $src
  pnpm build
  Pop-Location
} else { Write-Host '[1/3] 跳过构建（加 -Build 强制重建）' }

Write-Host '[2/3] 同步 lib/ 与 locale/ …'
foreach ($d in @('lib','locale')) {
  $s = Join-Path $src $d
  if (Test-Path $s) {
    $t = Join-Path $dst $d
    if (Test-Path $t) { Remove-Item $t -Recurse -Force }
    Copy-Item $s $t -Recurse -Force
    Write-Host ("     " + $d + " -> " + (Get-ChildItem $t -Recurse -File).Count + " files")
  }
}
Write-Host '[2/3] 同步清单文件…'
foreach ($f in @('cordis.patch.yml','server.json','icon.svg','README.md')) {
  $s = Join-Path $src $f
  if (Test-Path $s) { Copy-Item $s $dst -Force }
}
Write-Host '[3/3] 完成。重启 DSH NEXT 后生效（客户端 bundle 只在启动时下发）。'
Get-ChildItem (Join-Path $dst 'lib') -File | Select-Object Name,Length,LastWriteTime | Format-Table -AutoSize
