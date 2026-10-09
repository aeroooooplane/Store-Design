param([string]$OutputDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$partsRoot = Join-Path $PSScriptRoot 'zip-parts'
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $partsRoot 'parts-manifest.json') | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw 'OutputDirectory must be an existing directory.'
}
$target = Join-Path $OutputDirectory $manifest.archive
if (Test-Path -LiteralPath $target) {
    throw "Refusing to overwrite existing file: $target"
}
foreach ($part in $manifest.parts) {
    $path = Join-Path $partsRoot $part.file
    if ((Get-Item -LiteralPath $path).Length -ne $part.bytes) {
        throw "Part size mismatch; download the real LFS content: $($part.file)"
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() -ne $part.sha256) {
        throw "Part SHA256 mismatch: $($part.file)"
    }
}
$stream = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
try {
    foreach ($part in $manifest.parts) {
        $inputStream = [System.IO.File]::OpenRead((Join-Path $partsRoot $part.file))
        try { $inputStream.CopyTo($stream) } finally { $inputStream.Dispose() }
    }
} finally { $stream.Dispose() }
if ((Get-Item -LiteralPath $target).Length -ne $manifest.bytes -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant() -ne $manifest.sha256) {
    throw "Archive verification failed. Incomplete file retained for inspection: $target"
}
Write-Output "Verified archive: $target"
Write-Output "SHA256: $($manifest.sha256)"
