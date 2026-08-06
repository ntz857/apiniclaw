$ErrorActionPreference = "Stop"
$envFile = Join-Path $env:APPDATA "reasonix\.env"
$line = Get-Content $envFile | Where-Object { $_ -match "^\s*DEEPSEEK_API_KEY=(.+)$" } | Select-Object -First 1
if (-not $line) { throw "DEEPSEEK_API_KEY missing in $envFile" }
$env:DEEPSEEK_API_KEY = ($line -replace "^\s*DEEPSEEK_API_KEY=", "").Trim().Trim('"').Trim("'")
$env:DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
$env:TRANSLATE_MODEL = "deepseek-v4-flash"
$env:CONCURRENCY = "4"
$env:TIMEOUT_MS = "120000"
# clear matrix overrides if present
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
Set-Location "C:\Users\bunny\clickclaw"
$logDir = "C:\Users\bunny\clickclaw\.cache\awesome-souls"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "translate-deepseek.log"
"=== start $(Get-Date -Format o) model=$env:TRANSLATE_MODEL base=$env:DEEPSEEK_BASE_URL ===" | Out-File $log -Append -Encoding utf8
node scripts/translate-awesome-souls.mjs 2>&1 | Tee-Object -FilePath $log -Append
"EXIT=$LASTEXITCODE at $(Get-Date -Format o)" | Out-File $log -Append -Encoding utf8
