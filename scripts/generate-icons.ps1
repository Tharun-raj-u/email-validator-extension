Add-Type -AssemblyName System.Drawing
$base = "c:\Users\Administrator\Desktop\first-extension\icons"
$src = Join-Path $base "fleet-logo.png"
$img = [System.Drawing.Image]::FromFile((Resolve-Path $src))
foreach ($s in 16, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $s, $s)
  $g.Dispose()
  $out = Join-Path $base "icon$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "created $out"
}
$img.Dispose()
