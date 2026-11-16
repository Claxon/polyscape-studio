# Installs Polyscape Studio into Photoshop using Adobe's Unified Plugin Installer Agent.
param([string]$Ccx)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Ccx) { $Ccx = Join-Path $here 'PolyscapeStudio.ccx' }
if (-not (Test-Path $Ccx)) { Write-Host "Can't find $Ccx" -ForegroundColor Red; exit 1 }

$upia = Join-Path ${env:CommonProgramFiles} 'Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe'
if (-not (Test-Path $upia)) {
  Write-Host 'Adobe''s plugin installer was not found. Install Photoshop via Creative Cloud first.' -ForegroundColor Red
  exit 1
}

# The installer agent refuses some source locations (status -631), so install from a temp copy.
$tmp = Join-Path $env:TEMP ('PolyscapeStudio-' + [guid]::NewGuid().ToString('N') + '.ccx')
Copy-Item $Ccx $tmp
try {
  Write-Host 'Installing Polyscape Studio...'
  & $upia /install $tmp
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}

# The agent exits 0 even on failure, so check the installed list instead.
$installed = & $upia /list all | Select-String 'Polyscape Studio'
if ($installed) {
  Write-Host ''
  Write-Host 'Polyscape Studio is installed.' -ForegroundColor Green
  Write-Host 'Restart Photoshop, then use Plugins > Polyscape Studio > Open Polyscape Studio...'
  exit 0
}
Write-Host 'Installation failed - see the message above. Make sure you are signed in to Creative Cloud.' -ForegroundColor Red
exit 1
