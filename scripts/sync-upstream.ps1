<#
.SYNOPSIS
    Safely syncs and updates VynorAI with the latest Continue upstream repository.
.DESCRIPTION
    1. Ensures upstream remote is configured (https://github.com/continuedev/continue.git)
    2. Protects your local changes and active branch
    3. Fetches latest upstream changes
    4. Creates an isolated test branch (update/continue-sync)
    5. Merges upstream changes and checks for any breaking conflicts
#>

param(
    [string]$UpstreamUrl = "https://github.com/continuedev/continue.git",
    [string]$TargetBranch = "update/continue-sync"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "      🔄 VynorAI Continue Upstream Safe Sync Tool         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check Git Status
$status = git status --porcelain
if ($status) {
    Write-Host "[!] Warning: You have uncommitted changes in your workspace." -ForegroundColor Yellow
    Write-Host "    To avoid losing work, we recommend committing or stashing first." -ForegroundColor Yellow
    $confirm = Read-Host "    Do you want to stash your changes automatically? (y/n)"
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        git stash push -m "Auto-stashed before upstream sync on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        Write-Host "[+] Local changes safely stashed." -ForegroundColor Green
    } else {
        Write-Host "[-] Sync aborted. Please commit or stash your changes and re-run." -ForegroundColor Red
        exit 1
    }
}

# 2. Check / Add Upstream Remote
$remotes = git remote
if ($remotes -notcontains "upstream") {
    Write-Host "[*] Adding upstream remote: $UpstreamUrl" -ForegroundColor Cyan
    git remote add upstream $UpstreamUrl
} else {
    Write-Host "[✓] Upstream remote already configured." -ForegroundColor Green
}

# 3. Fetch Upstream Changes
Write-Host "[*] Fetching latest updates from upstream (continuedev/continue)..." -ForegroundColor Cyan
git fetch upstream main --tags
if ($LASTEXITCODE -ne 0) {
    Write-Host "[-] Failed to fetch from upstream. Check internet connection." -ForegroundColor Red
    exit 1
}

# 4. Create / Switch to Isolated Test Branch
Write-Host "[*] Switching to isolated branch: $TargetBranch..." -ForegroundColor Cyan
$branchExists = git branch --list $TargetBranch
if ($branchExists) {
    git checkout $TargetBranch
} else {
    git checkout -b $TargetBranch
}

# 5. Merge Upstream Main
Write-Host "[*] Merging upstream/main into $TargetBranch..." -ForegroundColor Cyan
git merge upstream/main --no-commit --no-ff

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " [✓] Upstream sync successfully merged into $TargetBranch!" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host " 1. Test build: npm run build (or cd backend && npm run build)" -ForegroundColor White
    Write-Host " 2. If everything works, commit and merge to your main branch:" -ForegroundColor White
    Write-Host "    git commit -m 'chore: sync latest Continue upstream updates'" -ForegroundColor Gray
    Write-Host "    git checkout main && git merge $TargetBranch" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host " [!] Merge conflicts detected!" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host "Conflicted files (review and resolve in VS Code):" -ForegroundColor Red
    git diff --name-only --diff-filter=U
    Write-Host ""
    Write-Host "To cancel and restore previous state:" -ForegroundColor White
    Write-Host "    git merge --abort" -ForegroundColor Cyan
    Write-Host "    git checkout main" -ForegroundColor Cyan
}
