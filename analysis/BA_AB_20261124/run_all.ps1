param([switch]$ExportRaw, [string]$Python='python', [string]$Matlab='D:/Program Files D/bin/matlab.exe')
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
    if ($ExportRaw) {
        & $Matlab -batch "run('src/export_ba.m')"
        if ($LASTEXITCODE -ne 0) { throw 'MATLAB export failed' }
    }
    foreach ($script in @('run_analysis.py','explore.py','quality_checks.py','make_figures.py')) {
        & $Python (Join-Path 'src' $script)
        if ($LASTEXITCODE -ne 0) { throw "Analysis failed: $script" }
    }
    & $Python -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) { throw 'Validation tests failed' }
} finally { Pop-Location }
