[CmdletBinding()]
param(
    [string]$ManagerAddress,
    [string]$AdvertiseIp,
    [string]$GlooInterface,
    [string]$PythonPath = '.\.venv\Scripts\python.exe'
)

$projectRoot = $PSScriptRoot
if (-not $ManagerAddress) { $ManagerAddress = Read-Host 'Manager LAN address (for example 192.168.1.10:50051)' }
if (-not $AdvertiseIp) { $AdvertiseIp = Read-Host 'This device physical LAN IPv4 address' }
if (-not $GlooInterface) { $GlooInterface = Read-Host 'Physical adapter name (for example Wi-Fi or Ethernet)' }

if (-not $ManagerAddress -or -not $AdvertiseIp -or -not $GlooInterface) {
    throw 'ManagerAddress, AdvertiseIp, and GlooInterface are required.'
}

$resolvedPython = if ([IO.Path]::IsPathRooted($PythonPath)) { $PythonPath } else { Join-Path $projectRoot $PythonPath }
if (-not (Test-Path -LiteralPath $resolvedPython)) {
    throw "Python executable not found: $resolvedPython"
}

$config = [ordered]@{
    managerAddress = $ManagerAddress.Trim()
    advertiseIp = $AdvertiseIp.Trim()
    glooInterface = $GlooInterface.Trim()
    pythonPath = (Resolve-Path -LiteralPath $resolvedPython).Path
}
$configPath = Join-Path $projectRoot 'dmlf-node.json'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
Write-Host "Saved DMLF node configuration to $configPath"
Write-Host 'Future worker start: .\start-dmlf-node.ps1'
