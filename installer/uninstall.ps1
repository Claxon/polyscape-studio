# Removes Polyscape Studio from Photoshop.
$upia = Join-Path ${env:CommonProgramFiles} 'Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe'
if (-not (Test-Path $upia)) { Write-Host 'Adobe plugin installer not found.' -ForegroundColor Red; exit 1 }
& $upia /remove 'Polyscape Studio'
Write-Host 'Done. Restart Photoshop.'
