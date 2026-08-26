# Deploy dsh-instance-manager INTO the local dsh web profile as a REAL
# directory snapshot (replacing any dev symlink).
#
# Why: a symlinked profile mount makes every working-tree edit a LIVE bundle
# change — cordis-plugin-hmr reloads running instances on each save, and
# multi-file refactors have inconsistent intermediate states that can take
# the whole instance down. Snapshot deployments decouple "me typing" from
# "fleet running": edit freely, deploy deliberately, restart instances once.
#
# Usage:
#   powershell -File scripts\deploy-profile.ps1              # default home
#   powershell -File scripts\deploy-profile.ps1 -DshHome X   # custom home
#
# After deploying, restart your dsh instances so they load the snapshot.

param([string]$DshHome = "$env:USERPROFILE\.dsh")

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $DshHome 'profiles\web\node_modules\dsh-instance-manager'

if (-not (Test-Path (Join-Path $repoRoot 'lib\index.js'))) {
  throw "run this script from the dsh-instance-manager checkout (missing lib\index.js under $repoRoot)"
}

$item = Get-Item $dst -ErrorAction SilentlyContinue
if ($item -and $item.LinkType) {
  Write-Host "removing dev link ($($item.LinkType)) at $dst"
  # Delete the LINK itself, never its target (the working tree!).
  $item.Delete()
} elseif (Test-Path $dst) {
  Write-Host "removing previous snapshot at $dst"
  Remove-Item -Recurse -Force $dst
}

New-Item -ItemType Directory -Force $dst | Out-Null
foreach ($name in 'lib', 'cordis.patch.yml', 'package.json', 'README.md', 'README.en.md') {
  Copy-Item (Join-Path $repoRoot $name) $dst -Recurse -Force
}

# Read as UTF-8 explicitly: package.json embeds Chinese descriptions, and
# Get-Content defaults to the system ANSI codepage (GBK on zh-CN), which
# corrupts UTF-8 and makes ConvertFrom-Json throw.
$version = (Get-Content (Join-Path $dst 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Host "deployed v$version -> $dst"
Write-Host 'next: restart your dsh instances (panel「停止当前」then relaunch),'
Write-Host 'and remember the working tree no longer feeds running instances.'
