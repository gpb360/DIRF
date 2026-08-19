Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sources = @(
  @{ Path = Join-Path $projectRoot 'snapshots\frame-00-at-26.7s.png'; Label = '01  Canonical handoff' },
  @{ Path = Join-Path $projectRoot 'snapshots\frame-01-at-133.3s.png'; Label = '02  Routed capability field' },
  @{ Path = Join-Path $projectRoot 'snapshots\frame-02-at-240.0s.png'; Label = '04  Evidence gate' },
  @{ Path = Join-Path $projectRoot 'snapshots\frame-03-at-346.7s.png'; Label = '05  Route / Record / Finish line' },
  @{ Path = Join-Path $projectRoot 'snapshots\frame-04-at-453.3s.png'; Label = '07  Exact next action' },
  @{ Path = Join-Path $projectRoot 'shorts\snapshots\frame-02-at-14.0s.png'; Label = 'SHORT 01  Canonical agreement' }
)

$outputDir = Join-Path $projectRoot 'review'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$output = Join-Path $outputDir 'episode-01-contact-sheet.png'

$canvas = New-Object System.Drawing.Bitmap 1920, 1080
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([System.Drawing.Color]::FromArgb(6, 16, 30))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

$titleFont = New-Object System.Drawing.Font 'Arial', 24, ([System.Drawing.FontStyle]::Bold)
$labelFont = New-Object System.Drawing.Font 'Consolas', 18, ([System.Drawing.FontStyle]::Bold)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 241, 255))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(155, 176, 201))
$bluePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(79, 140, 255)), 3
$graphics.DrawString('DIRF EPISODE 01  /  OPERATIONAL PRECISION', $titleFont, $white, 54, 18)

$tileWidth = 580
$tileHeight = 326
$gapX = 36
$gapY = 116
$originX = 54
$originY = 105

for ($i = 0; $i -lt $sources.Count; $i++) {
  $col = $i % 3
  $row = [math]::Floor($i / 3)
  $x = $originX + ($col * ($tileWidth + $gapX))
  $y = $originY + ($row * ($tileHeight + $gapY))
  $image = [System.Drawing.Image]::FromFile($sources[$i].Path)
  try {
    $target = New-Object System.Drawing.Rectangle $x, $y, $tileWidth, $tileHeight
    $sourceRatio = $image.Width / $image.Height
    $targetRatio = $tileWidth / $tileHeight
    if ($sourceRatio -gt $targetRatio) {
      $drawWidth = $tileWidth
      $drawHeight = [int]($tileWidth / $sourceRatio)
      $drawX = $x
      $drawY = $y + [int](($tileHeight - $drawHeight) / 2)
    } else {
      $drawHeight = $tileHeight
      $drawWidth = [int]($tileHeight * $sourceRatio)
      $drawX = $x + [int](($tileWidth - $drawWidth) / 2)
      $drawY = $y
    }
    $drawRect = New-Object System.Drawing.Rectangle $drawX, $drawY, $drawWidth, $drawHeight
    $graphics.DrawImage($image, $drawRect)
    $graphics.DrawRectangle($bluePen, $target)
    $graphics.DrawString($sources[$i].Label, $labelFont, $muted, $x, ($y + $tileHeight + 10))
  } finally {
    $image.Dispose()
  }
}

$canvas.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$bluePen.Dispose(); $white.Dispose(); $muted.Dispose(); $titleFont.Dispose(); $labelFont.Dispose(); $graphics.Dispose(); $canvas.Dispose()
Write-Output $output
