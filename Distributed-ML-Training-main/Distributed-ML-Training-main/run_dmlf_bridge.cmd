@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
if not exist logs mkdir logs
"%ROOT%..\..\.venv\Scripts\python.exe" -u -m dmlf.bridge >> "%ROOT%logs\bridge.stdout.log" 2>> "%ROOT%logs\bridge.stderr.log"
