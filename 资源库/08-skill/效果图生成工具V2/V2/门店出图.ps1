param(
    [ValidateSet('check','parse','preview','render','supplement','status')][string]$Action = 'check',
    [string]$BlenderPath,
    [string]$PythonPath = 'python',
    [string]$OutDir,
    [string]$Job,
    [string]$Source,
    [string]$Pages = '1',
    [string]$Views,
    [ValidateSet('draft','final')][string]$Profile,
    [switch]$RecoverIncomplete
)
$ErrorActionPreference = 'Stop'
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot ('renders\' + $Action) }
$entryScript = Join-Path $PSScriptRoot 'store-layout-render\scripts\pipeline.py'
$entryArgs = @($entryScript, $Action, '--out', $OutDir)
if ($BlenderPath) { $entryArgs += @('--blender', $BlenderPath) }
if ($Job) { $entryArgs += @('--job', $Job) }
if ($Source) { $entryArgs += @('--source', $Source, '--pages', $Pages) }
if ($Views) { $entryArgs += @('--views', $Views) }
if ($Profile) { $entryArgs += @('--profile', $Profile) }
if ($RecoverIncomplete) { $entryArgs += '--recover-incomplete' }
& $PythonPath @entryArgs
if ($LASTEXITCODE -ne 0) { throw ('Task stopped. Exit code: ' + $LASTEXITCODE) }
