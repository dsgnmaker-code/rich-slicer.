param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot 'Rich_Slicer_Easy.jsx'
$locations = @()
foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($root) {
        $base = Join-Path $root 'Adobe'
        if (Test-Path $base) {
            $locations += Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^Adobe Photoshop( |$)' -and (Test-Path (Join-Path $_.FullName 'Presets\Scripts')) } |
                ForEach-Object { Join-Path $_.FullName 'Presets\Scripts' }
        }
    }
}
$locations = @($locations | Select-Object -Unique)
if ($locations.Count -eq 0) { Write-Host 'No Photoshop Scripts folder found. Use Photoshop > File > Scripts > Browse instead.'; exit 1 }
$failed = @()
foreach ($dest in $locations) {
    try {
        Copy-Item -LiteralPath $scriptFile -Destination (Join-Path $dest 'Rich_Slicer_Easy.jsx') -Force
        Write-Host ('INSTALLED: ' + $dest)
    } catch { $failed += $dest }
}
if ($failed.Count -gt 0) {
    if ($Elevated) { Write-Host 'Cannot write to Photoshop Scripts folder even with administrator rights.'; exit 1 }
    Write-Host 'Need administrator permission to copy into Photoshop installation folder.'
    $arg = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Elevated'
    try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arg -Wait }
    catch { Write-Host ('Elevation canceled or failed: ' + $_.Exception.Message); exit 1 }
    exit 0
}
Write-Host 'Finished. Restart Photoshop, then open File > Scripts > Rich_Slicer_Easy.'
