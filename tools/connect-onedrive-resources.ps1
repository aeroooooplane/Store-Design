param(
  [string]$OneDriveRoot = $env:OneDrive,
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OneDriveRoot)) {
  throw '找不到 OneDrive 路径。请用 -OneDriveRoot 指定已同步到本机的 OneDrive 文件夹。'
}

$source = Join-Path $OneDriveRoot '门店生成工作台\资源库'
$link = Join-Path $RepositoryRoot '资源库'
$lock = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'resources.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$required = @(
  '04_模型库\manifest.json',
  '10_产品与陈列\展陈规则.xlsx',
  '01_各门店原图纸'
)
foreach ($item in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $item))) {
    throw "OneDrive 资源未就绪：$item。请等待同步完成并将所需文件设为‘始终保留在此设备上’。"
  }
}

foreach ($entry in $lock.requiredFiles.PSObject.Properties) {
  $file = Join-Path $source ($entry.Name.Replace('/', '\'))
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  if ($actual -ne $entry.Value) {
    throw "OneDrive 资源版本与当前代码不一致：$($entry.Name)。请等同步完成，并核对 resources.lock.json。"
  }
}
$pdfCount = @(Get-ChildItem -LiteralPath (Join-Path $source '01_各门店原图纸') -File -Filter '*.pdf').Count
if ($pdfCount -lt $lock.sourcePdfCount) {
  throw "原图纸数量不足：本机 $pdfCount，当前代码至少需要 $($lock.sourcePdfCount)。"
}

if (Test-Path -LiteralPath $link) {
  $existing = Get-Item -LiteralPath $link -Force
  if ($existing.LinkType -eq 'Junction' -and $existing.Target -eq $source) {
    Write-Host "资源库已连接：$link -> $source"
    exit 0
  }
  throw "目标位置已存在：$link。请先核对并备份现有资源，不会自动删除或覆盖。"
}

New-Item -ItemType Junction -Path $link -Target $source | Out-Null
Write-Host "资源库已连接：$link -> $source"
Write-Host '请运行 pnpm catalog:import，并用一份原图纸验证识别读取。'
