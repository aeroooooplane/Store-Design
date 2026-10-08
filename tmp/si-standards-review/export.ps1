$ErrorActionPreference = 'Stop'
$base = 'E:\效果图生成器\Store-Design\tmp\si-standards-review'
if (@(Get-ChildItem -LiteralPath $base -Filter 'SI1-part*.pptx').Count -ne 5) { throw 'SI1 临时副本已清理。请先在项目根目录运行 python tools/cleanup-review-copies.py --restore，再导出标准页面。' }
$app = New-Object -ComObject PowerPoint.Application
try {
 $files = @(Get-ChildItem -LiteralPath $base -Filter '*.pptx') + @(Get-ChildItem -LiteralPath 'E:\效果图生成器\Store-Design\设计标准' -Filter '*.pptx')
 foreach ($file in $files) {
  $label = if ($file.DirectoryName -eq $base) {$file.BaseName} else {'SI2'}
  $dest = Join-Path $base $label
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  $deck = $app.Presentations.Open($file.FullName, -1, 0, 0)
  try { $deck.Export($dest, 'PNG', 1600, 900); Write-Output "$label exported $($deck.Slides.Count)" } finally {$deck.Close()}
 }
} finally {$app.Quit()}
