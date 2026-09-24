$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pythonExe = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Missing local Python environment. See tools/training/README.md.' }
Push-Location $projectRoot
try {
    node tools/training/prepare-layout.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Layout preparation failed' }
    node --test tools/training/layout-model.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Layout tests failed' }
    node tools/training/train-layout.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Layout training failed' }
    & $pythonExe tools/training/prepare-style.py
    if ($LASTEXITCODE -ne 0) { throw 'Style preparation failed' }
    foreach ($styleName in @('SI1.0','SI2.0')) {
        & $pythonExe -u tools/training/train-style.py --style $styleName --mode smoke
        if ($LASTEXITCODE -ne 0) { throw "Style smoke failed: $styleName" }
    }
} finally { Pop-Location }
