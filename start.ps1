<#
.SYNOPSIS
  Arranca todo lo necesario y abre la landing en el navegador.

.DESCRIPTION
  Deja el sistema listo en un solo paso:
    1. Levanta el puente si no esta corriendo.
    2. Comprueba si Design Space tiene el puerto de depuracion abierto.
    3. Abre la landing en el navegador.

  NO cierra Design Space nunca. Si esta abierta sin el puerto de depuracion,
  avisa y sigue: las placas se crean igual, solo haran falta reinicios para
  verlas. Cerrarla es decision del usuario, porque puede tener trabajo sin
  guardar.
#>
[CmdletBinding()]
param(
  [int]$Port = 7788,
  [int]$CdpPort = 9222
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host ''
Write-Host '  Divergency Grabadora Láser' -ForegroundColor Cyan
Write-Host '  --------------------' -ForegroundColor Cyan
Write-Host ''

# --- 1. El puente ---
$bridge = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($bridge) {
  Write-Host "  [ok] Puente ya activo en el puerto $Port" -ForegroundColor Green
} else {
  Write-Host '  [..] Arrancando el puente...' -NoNewline
  Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $root -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(20)
  $up = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 700
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $up = $true; break }
  }
  Write-Host ''
  if ($up) {
    Write-Host "  [ok] Puente activo en el puerto $Port" -ForegroundColor Green
  } else {
    Write-Host '  [!!] El puente no arranco. Comprueba que Node este instalado (node --version).' -ForegroundColor Red
    Read-Host '  Pulsa Enter para salir'
    exit 1
  }
}

# --- 2. Design Space y el modo en vivo ---
$app = Get-Process | Where-Object { $_.ProcessName -match 'LaserPecker Design Space' }
$cdp = $null
try {
  $cdp = Invoke-WebRequest "http://127.0.0.1:$CdpPort/json/version" -UseBasicParsing -TimeoutSec 2
} catch {}

if ($cdp) {
  Write-Host '  [ok] Modo en vivo activo: las placas apareceran en la app al instante' -ForegroundColor Green
} elseif ($app) {
  # No se cierra por iniciativa propia: puede haber un diseno sin guardar.
  Write-Host '  [!!] Design Space esta abierta SIN el puerto de depuracion.' -ForegroundColor Yellow
  Write-Host '       Se pueden crear piezas, pero no grabar desde la landing.' -ForegroundColor Yellow
  Write-Host '       Para activarlo: el boton "Activar modo en vivo" de la landing,' -ForegroundColor Yellow
  Write-Host '       o guarda tu trabajo y ejecuta  .\launch-app.ps1' -ForegroundColor Yellow
} else {
  # Cerrada: no hay nada que perder, asi que se abre ya con el puerto. El como
  # vive solo en launch-app.ps1 para no tener dos versiones de lo mismo.
  Write-Host '  [..] Design Space esta cerrada. Abriendola con el puerto de depuracion...'
  & (Join-Path $root 'launch-app.ps1') -Port $CdpPort -Yes
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    Write-Host '  [!!] No se pudo dejar el modo en vivo activo; la landing lo puede reintentar.' -ForegroundColor Yellow
  }
}

# --- 3. La landing ---
Write-Host ''
Write-Host "  Abriendo http://127.0.0.1:$Port" -ForegroundColor Cyan
Start-Process "http://127.0.0.1:$Port"
Write-Host ''
Write-Host '  Listo. Pega la lista de nombres y pulsa Generar placas.' -ForegroundColor Green
Write-Host '  La impresora se conecta desde Design Space, arriba a la derecha.' -ForegroundColor Gray
Write-Host ''
Start-Sleep -Seconds 3
