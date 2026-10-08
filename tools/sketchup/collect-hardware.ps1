# Optional read-only Windows inspection. Writes only beside this script; no uploads.
$ErrorActionPreference = 'Stop'
$gpuInfo = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion)
$computerInfo = Get-CimInstance Win32_ComputerSystem
$osInfo = Get-CimInstance Win32_OperatingSystem
$nvidiaInfo = @()
$nvidiaCommand = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvidiaCommand) {
    $nvidiaInfo = @(& $nvidiaCommand.Source --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>&1 | ForEach-Object { "$_" })
}
$report = [ordered]@{
    os = $osInfo.Caption
    ramGiB = [math]::Round($computerInfo.TotalPhysicalMemory / 1GB, 1)
    gpu = $gpuInfo
    nvidiaSmi = $nvidiaInfo
    sketchupVersion = 'Please fill in from SketchUp About'
    note = 'No generic AdapterRAM estimate: report dedicated VRAM manually if NVIDIA query is unavailable.'
}
$reportPath = Join-Path $PSScriptRoot ('hardware-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
if (Test-Path -LiteralPath $reportPath) { throw 'Output already exists; retry after one second.' }
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output "Saved locally: $reportPath"
