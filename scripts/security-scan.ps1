param(
    [switch]$NoGitHistory
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $repoRoot

Write-Host "== vibe-trading-A security scan =="
Write-Host "Repo: $repoRoot"

if (-not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "gitleaks is not installed."
    Write-Host "Install with one of:"
    Write-Host "  winget install gitleaks"
    Write-Host "  scoop install gitleaks"
    exit 2
}

$modeArgs = @("detect", "--source", ".", "--config", ".gitleaks.toml", "--verbose", "--redact")
if ($NoGitHistory) {
    $modeArgs = @("dir", ".", "--config", ".gitleaks.toml", "--verbose", "--redact")
}

Write-Host ""
Write-Host "Running gitleaks..."
& gitleaks @modeArgs
if ($LASTEXITCODE -ne 0) {
    throw "gitleaks found potential leaks."
}

Write-Host ""
Write-Host "Checking tracked file paths..."
$suspiciousFiles = git ls-files | Select-String -Pattern '(^|/)(\.env$|.*\.db$|.*\.sqlite$|.*\.sqlite3$|.*\.pem$|.*\.key$|id_rsa|id_ed25519|node_modules/|dist/|__pycache__/|\.pytest_cache/|agent/data/|uploads/|cache/)'
if ($suspiciousFiles) {
    Write-Host $suspiciousFiles
    throw "Suspicious tracked file paths found."
}

Write-Host "No suspicious tracked file paths found."

Write-Host ""
Write-Host "Checking private local references..."
$privateMatches = git grep -n -I -E '(C:\\Users\\Edward|wxid_|AppData\\Local\\Temp|Documents\\xwechat_files|zhaomuyuan357-creator/Vibe-Trading|Vibe-Trading\.git)' -- . ':!.gitleaks.toml' ':!scripts/security-scan.ps1'
if ($LASTEXITCODE -eq 0) {
    Write-Host $privateMatches
    throw "Private local references found."
}

Write-Host "No private local references found."
Write-Host ""
Write-Host "Security scan passed."
