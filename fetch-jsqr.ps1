# QR Lens - fetch-jsqr.ps1
# One-time setup helper: downloads the jsQR decoder (Apache-2.0) into the
# extension root so the extension runs fully offline.
# The extension already ships with jsQR.js; use this only if it is missing or
# you want to refresh it on another machine.
#
# Run:  powershell -ExecutionPolicy Bypass -File .\fetch-jsqr.ps1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $root 'jsQR.js'

$sources = @(
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/gh/cozmo/jsQR@master/dist/jsQR.js',
  'https://raw.githubusercontent.com/cozmo/jsQR/master/dist/jsQR.js'
)

Write-Host 'QR Lens: downloading offline decoder jsQR.js ...'

foreach ($u in $sources) {
  Write-Host ('  trying ' + $u)
  try {
    Invoke-WebRequest -Uri $u -OutFile $dest -UseBasicParsing -TimeoutSec 30
    $len = (Get-Item $dest).Length
    if ($len -gt 10000) {
      Write-Host ('  OK: saved jsQR.js (' + $len + ' bytes) to ' + $dest) -ForegroundColor Green
      Write-Host '  Next: reload the extension on chrome://extensions.' -ForegroundColor Green
      exit 0
    }
    Remove-Item $dest -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Host ('  failed: ' + $_.Exception.Message)
  }
}

Write-Host 'All sources failed. You can also:' -ForegroundColor Yellow
Write-Host '  1) open https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js and save it as jsQR.js in this folder.' -ForegroundColor Yellow
Write-Host '  2) or run:  npm i jsqr  then copy node_modules\jsqr\dist\jsQR.js here.' -ForegroundColor Yellow
exit 1
