<#
.SYNOPSIS
  Construye DivergencyGrabadoraLaser.exe: un solo fichero, sin Node instalado.

.DESCRIPTION
  Usa las Single Executable Applications de Node: se cocina un "blob" con el
  codigo y los recursos y se inyecta dentro de una copia de node.exe. El
  resultado no necesita Node ni nada mas en la maquina de destino.

  Pasos:
    1. build/bundle.js       -> src/ en un solo .cjs + la config de SEA
    2. node --experimental-sea-config -> el blob (codigo + landing + logo + .ps1)
    3. copia de node.exe     -> el ejecutable en bruto
    4. rcedit (si hay red)   -> nombre y version en las propiedades del fichero
    5. postject              -> inyecta el blob en el ejecutable
    6. prueba de humo        -> lo arranca de verdad y le pide /api/templates
    7. publica en web/descargas/ con su sha256 y version.json

  El paso 4 va ANTES del 5 a proposito: rcedit reescribe los recursos del PE, y
  hacerlo despues podria tocar el recurso donde vive el blob.

.PARAMETER Salida
  Carpeta donde publicar. Por defecto web\descargas, que es lo que sirve la
  landing de descarga.

.PARAMETER SaltarPrueba
  No arranca el .exe para comprobarlo. Solo para depurar el propio build.

.PARAMETER SinMetadatos
  No intenta rcedit (que se descarga con npx). El .exe sale igual, pero con las
  propiedades de fichero de node.exe.

.EXAMPLE
  .\build\build.ps1
#>
[CmdletBinding()]
param(
  [string]$Salida,
  [switch]$SaltarPrueba,
  [switch]$SinMetadatos,
  [int]$PuertoPrueba = 17788
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'out'
if (-not $Salida) { $Salida = Join-Path $root 'web\descargas' }

$NOMBRE = 'DivergencyGrabadoraLaser.exe'
# El centinela que Node busca dentro de su propio binario para saber si lleva
# blob inyectado. Es un valor fijo del propio Node, no una eleccion de aqui.
$FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$nodeVer = (& node --version)

function Paso { param([string]$T) Write-Host "  $T" -ForegroundColor Cyan }
function Ok { param([string]$T) Write-Host "  [ok] $T" -ForegroundColor Green }
function Aviso { param([string]$T) Write-Host "  [!!] $T" -ForegroundColor Yellow }

Write-Host ''
Write-Host "  Divergency Grabadora Láser $version -> $NOMBRE" -ForegroundColor Cyan
Write-Host '  ----------------------------------------------' -ForegroundColor Cyan
Write-Host "  Node: $nodeVer ($nodeExe)" -ForegroundColor Gray
Write-Host ''

# Node 20.12+ para node:sea; 22.5+ para node:sqlite, que es lo que registra en
# la galeria. Si se construye con menos, el .exe compila y falla en marcha.
$mayor = [int]($nodeVer.TrimStart('v').Split('.')[0])
$menor = [int]($nodeVer.TrimStart('v').Split('.')[1])
if ($mayor -lt 22 -or ($mayor -eq 22 -and $menor -lt 5)) {
  throw "Hace falta Node 22.5 o mas nuevo para construir (node:sqlite); aqui hay $nodeVer"
}

# --- 1 y 2. Bundle y blob ---------------------------------------------------
Paso '1/7  Empaquetando src/ ...'
Push-Location $root
try {
  & node (Join-Path $PSScriptRoot 'bundle.js')
  if ($LASTEXITCODE -ne 0) { throw 'el bundle fallo' }

  Paso '2/7  Cocinando el blob de SEA ...'
  & node --experimental-sea-config (Join-Path $out 'sea-config.json')
  if ($LASTEXITCODE -ne 0) { throw 'la generacion del blob fallo' }
} finally {
  Pop-Location
}
$blob = Join-Path $out 'puente.blob'
Ok "blob: $([math]::Round((Get-Item $blob).Length / 1KB, 1)) KB"

# --- 3. Copia de node.exe ---------------------------------------------------
Paso '3/7  Copiando node.exe ...'
$exe = Join-Path $out $NOMBRE
Copy-Item $nodeExe $exe -Force
# La copia hereda la firma de Node, que la inyeccion invalida. Se quita a
# proposito: mejor sin firma que con una firma rota, que es peor senal.
try {
  $null = & signtool.exe remove /s $exe 2>&1  # no suele estar instalado; da igual
} catch {}
Ok "$NOMBRE en bruto: $([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB"

# --- 4. Propiedades del fichero --------------------------------------------
if ($SinMetadatos) {
  Aviso '4/7  Icono y propiedades omitidos (-SinMetadatos)'
} else {
  Paso '4/7  Poniendo icono y propiedades de fichero ...'
  try {
    # El icono se genera del logo con System.Drawing: nada que descargar.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'icono.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'no se pudo generar el icono' }

    # resedit no puede escribir sobre el mismo fichero que lee. Y hay que darle
    # permiso para tocar un binario firmado: node.exe lo esta, y esa firma la
    # invalida cualquier cambio -- lo asumimos aqui igual que en la inyeccion.
    $tmp = "$exe.meta"
    & npx --yes -p resedit-cli resedit `
      --in $exe --out $tmp --ignore-signed `
      --icon (Join-Path $out 'icono.ico') `
      --product-name 'Divergency Grabadora Láser' `
      --file-description 'Divergency Grabadora Láser - puente para LaserPecker Design Space' `
      --company-name 'Divergency AI' `
      --original-filename $NOMBRE `
      --internal-name $NOMBRE `
      --product-version "$version.0" `
      --file-version "$version.0" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp)) { throw "resedit salio con $LASTEXITCODE" }
    Move-Item $tmp $exe -Force
    Ok 'icono y propiedades escritos'
  } catch {
    # Sin red no hay resedit. El .exe funciona igual, solo se presenta como
    # node.exe en las propiedades del fichero.
    Aviso "sin icono ni propiedades ($($_.Exception.Message)); se sigue"
    Remove-Item "$exe.meta" -Force -ErrorAction SilentlyContinue
  }
}

# --- 5. Inyeccion -----------------------------------------------------------
Paso '5/7  Inyectando el blob (postject) ...'
& npx --yes postject $exe NODE_SEA_BLOB $blob --sentinel-fuse $FUSE --overwrite
if ($LASTEXITCODE -ne 0) { throw 'postject fallo: sin blob inyectado el .exe seria un node.exe pelado' }
Ok "inyectado: $([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB"

# --- 6. Prueba de humo ------------------------------------------------------
#
# Se arranca el .exe de verdad y se le pide algo que obliga a leer los recursos
# embebidos. Publicar sin esto es publicar un ejecutable que nadie ha abierto.
if ($SaltarPrueba) {
  Aviso '6/7  Prueba omitida (-SaltarPrueba)'
} else {
  Paso "6/7  Probandolo en el puerto $PuertoPrueba ..."
  $env:PORT = "$PuertoPrueba"
  $env:LP_OPEN = '0'   # que no abra el navegador durante el build
  $proc = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
  try {
    $base = "http://127.0.0.1:$PuertoPrueba"
    $listo = $false
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not $listo) {
      Start-Sleep -Milliseconds 400
      try {
        $t = Invoke-RestMethod "$base/api/templates" -TimeoutSec 3
        if ($t.ok) { $listo = $true }
      } catch {}
    }
    if (-not $listo) { throw "el .exe no respondio en $base" }

    $landing = Invoke-WebRequest "$base/" -UseBasicParsing -TimeoutSec 5
    if ($landing.StatusCode -ne 200 -or $landing.Content.Length -lt 1000) { throw 'la landing embebida no se sirvio' }
    $logo = Invoke-WebRequest "$base/logo.png" -UseBasicParsing -TimeoutSec 5
    if ($logo.StatusCode -ne 200) { throw 'el logo embebido no se sirvio' }
    $medida = Invoke-RestMethod "$base/api/measure?template=placa&name=Viviana%20Jimenez" -TimeoutSec 5
    if (-not $medida.ok) { throw 'la medida de texto fallo' }

    Ok "responde: landing $([math]::Round($landing.Content.Length/1KB,1)) KB, logo $($logo.RawContentLength) B, plantillas $($t.templates.Count), medida $($medida.widthMm)x$($medida.heightMm) mm"
  } finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item Env:\PORT, Env:\LP_OPEN -ErrorAction SilentlyContinue
  }
}

# --- 7. Publicacion --------------------------------------------------------
Paso "7/7  Publicando en $Salida ..."
New-Item -ItemType Directory -Force -Path $Salida | Out-Null
$destino = Join-Path $Salida $NOMBRE
Copy-Item $exe $destino -Force

$item = Get-Item $destino
$sha = (Get-FileHash $destino -Algorithm SHA256).Hash.ToLower()
$fecha = $item.LastWriteTime.ToString('yyyy-MM-dd')

# La landing lee esto para no tener el tamano y el hash escritos a mano, que es
# como acaban mintiendo.
$json = [pscustomobject]@{
  producto = 'Divergency Grabadora Láser'
  version  = $version
  archivo  = $NOMBRE
  bytes    = $item.Length
  tamano   = "$([math]::Round($item.Length / 1MB, 1)) MB"
  sha256   = $sha
  fecha    = $fecha
  node     = $nodeVer
} | ConvertTo-Json

# Sin BOM: Windows PowerShell lo mete con -Encoding utf8, y un BOM delante hace
# que JSON.parse del navegador falle -- la landing se quedaria con el tamano
# aproximado escrito a mano y nadie se enteraria de por que.
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $Salida 'version.json'), $json + "`n", $utf8)
[System.IO.File]::WriteAllText((Join-Path $Salida "$NOMBRE.sha256.txt"), "$sha *$NOMBRE`n", $utf8)

Write-Host ''
Ok "$destino"
Write-Host "       $([math]::Round($item.Length / 1MB, 1)) MB   sha256 $($sha.Substring(0,16))..." -ForegroundColor Gray
Write-Host ''
Write-Host '  Landing de descarga:  node web\serve.js' -ForegroundColor Cyan
Write-Host ''
