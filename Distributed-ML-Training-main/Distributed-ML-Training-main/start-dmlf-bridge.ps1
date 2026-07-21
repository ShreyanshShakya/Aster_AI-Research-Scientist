[CmdletBinding()]
param()

$projectRoot = $PSScriptRoot
$configPath = Join-Path $projectRoot 'dmlf-node.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Missing $configPath. Run .\setup-dmlf-node.ps1 once on the manager machine."
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $config.managerAddress -or -not $config.pythonPath) { throw 'DMLF node configuration is incomplete.' }
if (-not (Test-Path -LiteralPath $config.pythonPath)) { throw "Configured Python executable not found: $($config.pythonPath)" }

$env:DMLF_MANAGER_ADDR = $config.managerAddress
Write-Host "Starting DMLF bridge for manager $env:DMLF_MANAGER_ADDR"
& $config.pythonPath -m dmlf.bridge
