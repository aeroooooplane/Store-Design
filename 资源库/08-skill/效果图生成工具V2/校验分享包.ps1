$ErrorActionPreference = 'Stop'
$shareRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$items = @(Import-Csv -LiteralPath (Join-Path $PSScriptRoot '分享文件校验清单.csv') -Encoding UTF8)
$failures = @()
foreach ($item in $items) {
    $target = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $item.RelativePath))
    if (-not $target.StartsWith($shareRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Unsafe path in manifest.'
    }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        $failures += $item.RelativePath
        continue
    }
    $file = Get-Item -LiteralPath $target
    if ($file.Length -ne [long]$item.Bytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $item.SHA256) {
        $failures += $item.RelativePath
    }
}
if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Output ('FAILED: ' + $_) }
    throw ('Integrity check failed: ' + $failures.Count)
}
Write-Output ('PASS: ' + $items.Count + ' files verified. No files changed.')
