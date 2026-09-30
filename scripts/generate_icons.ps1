Add-Type -AssemblyName System.Drawing

# Create 48x48 transparent bitmap for sidebar icon
$bmp = New-Object System.Drawing.Bitmap 48, 48
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Draw stylized V for VynorAI
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 230, 240, 255)), 5
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

# Points for V
$p1 = New-Object System.Drawing.Point 8, 12
$p2 = New-Object System.Drawing.Point 24, 38
$p3 = New-Object System.Drawing.Point 40, 12

$points = [System.Drawing.Point[]]@($p1, $p2, $p3)
$g.DrawLines($pen, $points)

# Add small cyan accent dot at vertex or top
$accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 210, 255))
$g.FillEllipse($accentBrush, 21, 16, 6, 6)

$g.Dispose()
$bmp.Save("d:\My Project\VynorAI\extensions\vscode\media\sidebar-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Sidebar icon created successfully!"
