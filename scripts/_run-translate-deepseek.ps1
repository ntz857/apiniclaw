$ErrorActionPreference = "Stop"
$envFile = Join-Path $env:APPDATA "reasonix\.env"
$line = Get-Content $envFile | Where-Object { $_ -match "^\s*DEEPSEEK_API_KEY=(.+)$" } | Select-Object -First 1
if (-not $line) { throw "DEEPSEEK_API_KEY missing in $envFile" }
$env:DEEPSEEK_API_KEY = ($line -replace "^\s*DEEPSEEK_API_KEY=", "").Trim().Trim('"').Trim("'")
$env:DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
$env:TRANSLATE_MODEL = "deepseek-chat"
$env:CONCURRENCY = "6"
$env:TIMEOUT_MS = "120000"
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
# repo root = parent of scripts/
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = Get-Location }
Set-Location $root
$logDir = Join-Path $root ".cache\awesome-souls"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
node scripts/translate-awesome-souls.mjs 2>&1 | Tee-Object -FilePath (Join-Path $logDir "translate-deepseek.log")
