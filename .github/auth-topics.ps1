Set-Location "E:\.codes\createhelper\dsh-easy-port-manager"
Write-Host "=== GitHub CLI login (browser flow) ==="
Write-Host "按提示操作：记下一次性代码 -> 回车打开浏览器 -> 粘贴代码授权"
Write-Host ""
gh auth login --hostname github.com --git-protocol ssh --web
if ($LASTEXITCODE -ne 0) { Write-Host "login failed - close and retry"; exit 1 }
Write-Host ""
Write-Host "=== setting repository topics ==="
gh api --method PUT "repos/xswt442-cmd/dsh-easy-port-manager/topics" `
  -f "names[]=dsh-plugin" `
  -f "names[]=deepseek-harness" `
  -f "names[]=dsh" `
  -f "names[]=deepseek"
Write-Host ""
Write-Host "=== done ==="
Write-Host "topics 已设置。这个窗口可以关了。"
