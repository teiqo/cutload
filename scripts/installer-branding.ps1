Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot '../src-tauri/icons'
$logo = [System.Drawing.Image]::FromFile((Join-Path $assetDir '128x128@2x.png'))
foreach ($kind in @('header','sidebar')) {
    $width = if ($kind -eq 'header') {150} else {164}
    $height = if ($kind -eq 'header') {57} else {314}
    $canvas = New-Object System.Drawing.Bitmap($width,$height)
    $drawing = [System.Drawing.Graphics]::FromImage($canvas)
    $drawing.SmoothingMode = 'AntiAlias'
    $drawing.InterpolationMode = 'HighQualityBicubic'
    $bounds = New-Object System.Drawing.Rectangle(0,0,$width,$height)
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $drawing.FillRectangle($fill,$bounds)
    if ($kind -eq 'header') {
        $drawing.DrawImage($logo,8,8,40,40)
        $font = New-Object System.Drawing.Font('Segoe UI',16,[System.Drawing.FontStyle]::Bold)
        $drawing.DrawString('cutload',$font,[System.Drawing.Brushes]::DimGray,52,12)
    } else {
        $drawing.DrawImage($logo,26,73,112,112)
        $font = New-Object System.Drawing.Font('Segoe UI',20,[System.Drawing.FontStyle]::Bold)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = 'Center'
        $textBounds = New-Object System.Drawing.RectangleF(0,198,164,50)
        $drawing.DrawString('cutload',$font,[System.Drawing.Brushes]::DimGray,$textBounds,$format)
        $format.Dispose()
    }
    $canvas.Save((Join-Path $assetDir "installer-$kind.bmp"),[System.Drawing.Imaging.ImageFormat]::Bmp)
    $font.Dispose(); $fill.Dispose(); $drawing.Dispose(); $canvas.Dispose()
}
$logo.Dispose()
