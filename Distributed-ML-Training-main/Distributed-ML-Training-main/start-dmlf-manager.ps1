[CmdletBinding()]
param([int]$Port = 50051)

$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw "Python executable not found: $python" }
& $python -m dmlf.manager.cluster_manager --port $Port
