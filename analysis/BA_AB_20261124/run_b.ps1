param([string]$Python='python')
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
    foreach ($script in @('discover.py','control_phase.py','summarize.py')) {
        & $Python (Join-Path 'route_b/src' $script)
        if ($LASTEXITCODE -ne 0) { throw "Route B failed: $script" }
    }
} finally { Pop-Location }
