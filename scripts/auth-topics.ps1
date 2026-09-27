param(
  # The repository the topics are written to, as `owner/name`. There is
  # deliberately no default and no hard-coded owner in this file: who owns the
  # repository is a fact about a specific deployment, and a tracked script that
  # states it silently points every other clone at somebody else's repository.
  # Pass it explicitly — `git remote get-url origin` names it.
  [Parameter(Mandatory = $true)]
  [string]$Repo
)

if ($Repo -notmatch '^[^/\s]+/[^/\s]+$') {
  Write-Host "expected -Repo as 'owner/name', got: $Repo"
  exit 1
}

Set-Location (Join-Path $PSScriptRoot "..")
Write-Host "=== GitHub CLI login (browser flow) ==="
Write-Host "按提示操作：记下一次性代码 -> 回车打开浏览器 -> 粘贴代码授权"
Write-Host ""
gh auth login --hostname github.com --git-protocol ssh --web
if ($LASTEXITCODE -ne 0) { Write-Host "login failed - close and retry"; exit 1 }
Write-Host ""
Write-Host "=== setting repository topics on $Repo ==="
gh api --method PUT "repos/$Repo/topics" `
  -f "names[]=dsh-plugin" `
  -f "names[]=deepseek-harness" `
  -f "names[]=dsh" `
  -f "names[]=deepseek"
Write-Host ""
Write-Host "=== done ==="
Write-Host "topics 已设置。这个窗口可以关了。"
