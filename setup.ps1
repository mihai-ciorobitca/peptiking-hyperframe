$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
& node -e "if(Number(process.versions.node.split('.')[0]) < 22) { console.error('Install Node.js 22 or newer.'); process.exit(1) }"
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer is required.' }
& npm.cmd ci --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Worker dependency installation failed.' }
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
  if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 -m venv .venv }
  else { & python -m venv .venv }
  if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.10 or newer, then run setup again.' }
}
& ./.venv/Scripts/python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Local transcription installation failed.' }
& ./.venv/Scripts/python.exe transcribe.py --prepare --model base
if ($LASTEXITCODE -ne 0) { throw 'Local speech model download failed. Check internet access and retry setup.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env'))) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.env.example') -Destination (Join-Path $PSScriptRoot '.env')
}
Write-Host 'Installed. Fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.'
Write-Host 'Run npm run login to sign into your existing ChatGPT account, if the CLI is not already signed in.'
Write-Host 'Then run: npm run doctor'
Write-Host 'Then run: npm run smoke'
Write-Host 'Then run: npm run smoke:codex'
Write-Host 'Then run: npm start'
