# Phase 0 spike (Windows): skeleton JSON -> .spine project -> exported JSON -> runtime check.
# Usage: $env:SPINE_VERSION = "4.3.xx"; .\spike\spine-roundtrip.ps1
# Uses the Spine Editor already installed and activated on this machine. No license key is read here.
$ErrorActionPreference = "Stop"

$SpineExe = if ($env:SPINE_EXE) { $env:SPINE_EXE } else { "C:\Program Files\Spine\Spine.com" }
if (-not $env:SPINE_VERSION) { throw "Set SPINE_VERSION, e.g. 4.3.xx (Help > About in Spine)" }
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Fixture = Join-Path $Root "spike\fixtures\swing"
$Out = Join-Path $Root "spike\out"

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force (Join-Path $Out "export") | Out-Null

function Invoke-Spine { & $SpineExe @args; if ($LASTEXITCODE -ne 0) { throw "Spine CLI failed: $args" } }

Write-Host "== 1. import JSON into a new .spine project"
Invoke-Spine -u $env:SPINE_VERSION -i "$Fixture\skeleton.json" -o "$Out\swing.spine" -r swing

Write-Host "== 2. export the project back to JSON"
Invoke-Spine -u $env:SPINE_VERSION -i "$Out\swing.spine" -o "$Out\export" -e json

Write-Host "== 3. load the exported JSON with the 4.3 runtime"
Copy-Item "$Fixture\swing.atlas", "$Fixture\swing.png" "$Out\export\"
Copy-Item -Recurse "$Fixture\images" "$Out\export\"
$Exported = Get-ChildItem -Recurse "$Out\export" -Filter *.json | Select-Object -First 1
Push-Location $Root
try { npx tsx spike/runtime-check.ts $Exported.FullName; if ($LASTEXITCODE -ne 0) { throw "runtime check failed" } }
finally { Pop-Location }

Write-Host "== done. Open $Out\swing.spine in Spine to check it visually."
