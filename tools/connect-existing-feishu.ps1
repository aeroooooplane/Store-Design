# Restores credentials for the existing app only. Never creates a new app.
$ErrorActionPreference = 'Stop'
$cliEntry = Join-Path $env:APPDATA 'npm/node_modules/@larksuite/cli/scripts/run.js'
if (-not (Test-Path -LiteralPath $cliEntry)) { throw 'lark-cli entry point not found.' }
$appId = 'cli_aa1d26aa2539dbef'
Write-Host "Configure existing Feishu app: $appId"
Write-Host 'Paste App Secret locally. Input is hidden and is not saved in this script.'
$secureSecret = Read-Host 'App Secret' -AsSecureString
try {
    $credential = New-Object System.Management.Automation.PSCredential('app', $secureSecret)
    $credential.GetNetworkCredential().Password | & node $cliEntry config init --app-id $appId --app-secret-stdin --brand feishu | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'CLI credential configuration failed.' }
    Write-Host 'Existing app configured. Return to Codex to request the read-only authorization QR.'
} finally {
    $credential = $null
    $secureSecret.Dispose()
}
