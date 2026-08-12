<#
.SYNOPSIS
  Genera build\out\icono.ico a partir del logo, para el .exe.

.DESCRIPTION
  El logo completo ("Divergency AI") es una tira de 300x119: a 16 px en el
  Explorador no se leeria nada. Asi que se recorta solo la "D" -- se localiza
  midiendo donde hay tinta en el tercio izquierdo, no con coordenadas a mano, que
  se romperian al cambiar el PNG -- y se centra sobre un cuadrado blanco.

  Blanco y no transparente a proposito: la marca es azul muy oscuro y sobre la
  barra de tareas en modo oscuro desapareceria.

  El .ico lleva las seis medidas que pide Windows, cada una redibujada desde el
  original en vez de reescalada desde la grande, que es lo que las deja borrosas.

  Solo necesita System.Drawing, que viene con Windows: ni npm ni herramientas.
#>
[CmdletBinding()]
param(
  [string]$Origen,
  [string]$Destino
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $Origen) { $Origen = Join-Path $root 'assets\divergency-logo-original.png' }
if (-not $Destino) { $Destino = Join-Path $PSScriptRoot 'out\icono.ico' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destino) | Out-Null

$src = [System.Drawing.Bitmap]::FromFile($Origen)
try {
  # --- Donde esta la "D" -----------------------------------------------------
  #
  # Tinta = pixel opaco y oscuro. La D es el primer trazo por la izquierda y esta
  # separada del texto por una columna en blanco, asi que se coge la PRIMERA
  # racha de columnas con tinta y se corta en ese hueco. Con un porcentaje fijo
  # del ancho se colaba la "i" de "ivergency".
  $tinta = New-Object bool[] $src.Width
  $hasta = [int]($src.Width * 0.5)
  for ($x = 0; $x -lt $hasta; $x++) {
    for ($y = 0; $y -lt $src.Height; $y++) {
      $p = $src.GetPixel($x, $y)
      if ($p.A -gt 32 -and $p.GetBrightness() -lt 0.6) { $tinta[$x] = $true; break }
    }
  }

  $x0 = 0
  while ($x0 -lt $hasta -and -not $tinta[$x0]) { $x0++ }
  if ($x0 -ge $hasta) { throw "No se encontro tinta en la mitad izquierda de $Origen" }
  $x1 = $x0
  while ($x1 + 1 -lt $hasta -and $tinta[$x1 + 1]) { $x1++ }

  # Alto: solo dentro de esas columnas.
  $y0 = $src.Height; $y1 = -1
  for ($x = $x0; $x -le $x1; $x++) {
    for ($y = 0; $y -lt $src.Height; $y++) {
      $p = $src.GetPixel($x, $y)
      if ($p.A -gt 32 -and $p.GetBrightness() -lt 0.6) {
        if ($y -lt $y0) { $y0 = $y }
        if ($y -gt $y1) { $y1 = $y }
      }
    }
  }

  $marca = [System.Drawing.Rectangle]::FromLTRB($x0, $y0, $x1 + 1, $y1 + 1)
  Write-Verbose "Marca localizada: $($marca.Width)x$($marca.Height) en ($($marca.X),$($marca.Y))"

  # --- Un PNG por medida -----------------------------------------------------
  function Render {
    param([int]$Lado)

    $bmp = New-Object System.Drawing.Bitmap($Lado, $Lado, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)

      # Fondo redondeado. En 16 px una esquina redonda se convierte en ruido, asi
      # que el radio baja con el tamano hasta desaparecer.
      $r = [Math]::Max(1, [int]($Lado * 0.17))
      $fondo = New-Object System.Drawing.Drawing2D.GraphicsPath
      if ($Lado -le 20) {
        $fondo.AddRectangle((New-Object System.Drawing.Rectangle(0, 0, $Lado, $Lado)))
      } else {
        $d = $r * 2
        $fondo.AddArc(0, 0, $d, $d, 180, 90)
        $fondo.AddArc($Lado - $d, 0, $d, $d, 270, 90)
        $fondo.AddArc($Lado - $d, $Lado - $d, $d, $d, 0, 90)
        $fondo.AddArc(0, $Lado - $d, $d, $d, 90, 90)
        $fondo.CloseFigure()
      }
      $blanco = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
      $g.FillPath($blanco, $fondo)

      # La marca, centrada, con aire alrededor (mas aire cuanto mas grande).
      $margen = [Math]::Max(1, [int]($Lado * 0.16))
      $caja = $Lado - 2 * $margen
      $escala = [Math]::Min($caja / $marca.Width, $caja / $marca.Height)
      $w = $marca.Width * $escala
      $h = $marca.Height * $escala
      $destino = New-Object System.Drawing.RectangleF ((($Lado - $w) / 2), (($Lado - $h) / 2), $w, $h)
      $g.DrawImage($src, $destino, $marca, [System.Drawing.GraphicsUnit]::Pixel)

      $blanco.Dispose(); $fondo.Dispose()
    } finally {
      $g.Dispose()
    }

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    # La coma es imprescindible: sin ella PowerShell desenrolla el byte[] en la
    # tuberia y lo que llega al otro lado es un Object[] de bytes, que
    # BinaryWriter no escribe como el buffer que parece.
    return , [byte[]]$ms.ToArray()
  }

  $medidas = @(256, 128, 64, 48, 32, 16)
  $pngs = @{}
  foreach ($m in $medidas) { $pngs[$m] = Render -Lado $m }

  # --- Contenedor .ico -------------------------------------------------------
  #
  # ICONDIR (6 bytes) + una ICONDIRENTRY de 16 por medida + los PNG detras.
  # Windows acepta entradas comprimidas en PNG desde Vista; el lado 256 se
  # escribe como 0, que es como el formato dice "256".
  $fs = [System.IO.File]::Create($Destino)
  $bw = New-Object System.IO.BinaryWriter($fs)
  try {
    $bw.Write([uint16]0)                 # reservado
    $bw.Write([uint16]1)                 # tipo: icono
    $bw.Write([uint16]$medidas.Count)

    $offset = 6 + 16 * $medidas.Count
    foreach ($m in $medidas) {
      $bw.Write([byte]($(if ($m -ge 256) { 0 } else { $m })))  # ancho
      $bw.Write([byte]($(if ($m -ge 256) { 0 } else { $m })))  # alto
      $bw.Write([byte]0)                 # colores de paleta: ninguna
      $bw.Write([byte]0)                 # reservado
      $bw.Write([uint16]1)               # planos
      $bw.Write([uint16]32)              # bits por pixel
      $bw.Write([uint32]$pngs[$m].Length)
      $bw.Write([uint32]$offset)
      $offset += $pngs[$m].Length
    }
    # Con los tres argumentos no hay duda de sobrecarga: es el buffer entero.
    foreach ($m in $medidas) { $bw.Write([byte[]]$pngs[$m], 0, $pngs[$m].Length) }
  } finally {
    $bw.Dispose(); $fs.Dispose()
  }
} finally {
  $src.Dispose()
}

Write-Host "  [ok] icono: $Destino ($([math]::Round((Get-Item $Destino).Length / 1KB, 1)) KB, $($medidas -join '/') px)" -ForegroundColor Green
