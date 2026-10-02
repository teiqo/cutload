$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$binRoot = Join-Path $appRoot 'src-tauri/binaries'
New-Item -ItemType Directory -Force -Path $binRoot | Out-Null
foreach ($tool in @('yt-dlp','ffmpeg')) {
  $command = Get-Command "$tool.exe" -ErrorAction Stop
  $item = Get-Item -LiteralPath $command.Source
  $source = if ($item.Target) { $item.Target } else { $item.FullName }
  Copy-Item -LiteralPath $source -Destination (Join-Path $binRoot "$tool.exe") -Force
  if ($tool -eq 'ffmpeg') {
    $probe = Join-Path (Split-Path -Parent $source) 'ffprobe.exe'
    if (Test-Path -LiteralPath $probe) { Copy-Item -LiteralPath $probe -Destination (Join-Path $binRoot 'ffprobe.exe') -Force }
    Get-ChildItem -LiteralPath (Split-Path -Parent $source) -Filter '*.dll' | Copy-Item -Destination $binRoot -Force
  }
}
Write-Output "Prepared downloader tools in $binRoot"
