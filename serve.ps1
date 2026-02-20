$ErrorActionPreference = "Stop"

$port = 5173

Write-Host "Starting local server on http://localhost:$port/"
Write-Host "Close this window to stop."

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -m http.server $port
  exit 0
}

if (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $port
  exit 0
}

Write-Host "Python not found. Install Python or use VS Code Live Server."
exit 1

