# SwarmAI setup for Windows (PowerShell 5.1+ or PowerShell 7).
#   .\setup.ps1                 full guided setup (keys -> Docker -> build -> n8n -> start)
#   .\setup.ps1 start|stop|restart|status|doctor|configure|n8n|tunnel
#   .\setup.ps1 setup --tunnel  also opens a Cloudflare tunnel for Telegram/WhatsApp webhooks
#   .\setup.ps1 setup --yes     non-interactive
# If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\setup.ps1   (or double-click setup.cmd)
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Test-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# --- Node.js 20+ ---
$nodeOk = $false
if (Test-Command node) {
  $major = [int]((node -p "process.versions.node.split('.')[0]") | Out-String).Trim()
  $nodeOk = $major -ge 20
}
if (-not $nodeOk) {
  Write-Host 'Node.js 20+ is required.' -ForegroundColor Yellow
  if (Test-Command winget) {
    $a = Read-Host 'Install Node.js LTS with winget now? [y/N]'
    if ($a -match '^[Yy]') {
      winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
      Refresh-Path
    }
  }
  if (-not (Test-Command node)) {
    Write-Host 'Install Node.js LTS: winget install OpenJS.NodeJS.LTS  (or https://nodejs.org), open a new terminal and re-run.' -ForegroundColor Red
    exit 1
  }
}

# --- Docker Desktop ---
if (-not (Test-Command docker)) {
  Write-Host 'Docker Desktop is required.' -ForegroundColor Yellow
  if (Test-Command winget) {
    $a = Read-Host 'Install Docker Desktop with winget now? [y/N]'
    if ($a -match '^[Yy]') {
      winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
      Write-Host 'Docker Desktop installed. Start it (enable WSL 2 if asked), wait until it is running, then re-run .\setup.ps1' -ForegroundColor Cyan
      exit 0
    }
  }
  Write-Host 'Install: winget install Docker.DockerDesktop  (https://docker.com/products/docker-desktop), start it, then re-run.' -ForegroundColor Red
  exit 1
}

node scripts/swarm.mjs @args
exit $LASTEXITCODE
