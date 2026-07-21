[CmdletBinding()]
param()

$projectRoot = $PSScriptRoot
$configPath = Join-Path $projectRoot 'dmlf-node.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Missing $configPath. Run .\setup-dmlf-node.ps1 once on this device."
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
foreach ($property in 'managerAddress', 'advertiseIp', 'glooInterface', 'pythonPath') {
    if (-not $config.$property) { throw "DMLF node configuration is missing '$property'. Run .\setup-dmlf-node.ps1 again." }
}
if (-not (Test-Path -LiteralPath $config.pythonPath)) { throw "Configured Python executable not found: $($config.pythonPath)" }

$env:DMLF_ADVERTISE_IP = $config.advertiseIp
$env:DMLF_GLOO_INTERFACE = $config.glooInterface
Write-Host "Starting DMLF agent; advertising $($config.advertiseIp) through $($config.glooInterface) to $($config.managerAddress)"
& $config.pythonPath -m dmlf.agent.agent --manager $config.managerAddress
