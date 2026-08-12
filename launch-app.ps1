<#
.SYNOPSIS
  Deja LaserPecker Design Space corriendo con el puerto de depuracion abierto.

.DESCRIPTION
  Design Space arranca sin --remote-debugging-port, asi que su renderer no es
  alcanzable y el puente no puede ni registrar en la galeria en vivo ni grabar.
  Este script se asegura de que la app termine corriendo CON el puerto abierto.

  Es idempotente: si ya esta abierta con el puerto y el depurador responde, no
  toca nada y sale con exito. Solo cierra y reabre cuando hace falta de verdad.

  El cierre es ORDENADO: se pide a la ventana que se cierre, de modo que la app
  pueda preguntar por el trabajo sin guardar. Nunca se mata el proceso salvo
  que se pase -Force.

.PARAMETER Port
  Puerto de depuracion. Por defecto 9222 (el que espera el puente).

.PARAMETER Force
  Mata el proceso sin pedir cierre ordenado. DESCARTA el trabajo sin guardar.

.PARAMETER Yes
  No pregunta antes de cerrar. Para llamadas automaticas (el puente lo usa).

.PARAMETER Json
  Emite el resultado como una sola linea JSON en vez de texto para humanos.

.PARAMETER CrearAtajo
  Crea en el Escritorio un acceso directo que abre la app ya con el puerto.
  Asi deja de hacer falta este script: se abre desde ahi y el modo en vivo
  esta activo desde el primer segundo.

.PARAMETER Exe
  Ruta al ejecutable, por si esta instalado en un sitio poco habitual.

.EXAMPLE
  .\launch-app.ps1

.EXAMPLE
  .\launch-app.ps1 -CrearAtajo     # y a partir de ahora, abrir desde el atajo
#>
[CmdletBinding()]
param(
  [int]$Port = 9222,
  [switch]$Force,
  [switch]$Yes,
  [switch]$Json,
  [switch]$CrearAtajo,
  [string]$Exe
)

$ErrorActionPreference = 'Stop'

$EXE_NAME  = 'LaserPecker Design Space.exe'
$PROC_NAME = 'LaserPecker Design Space'
$APP_PORT  = 9898   # el Express propio de la app; sirve para saber si sigue viva

$script:Log = New-Object System.Collections.Generic.List[string]
$script:ExePath = $null

function Say {
  param([string]$Text, [string]$Color = 'Gray', [switch]$NoNewline)
  $script:Log.Add($Text.Trim())
  if (-not $Json) { Write-Host $Text -ForegroundColor $Color -NoNewline:$NoNewline }
}

<#
  Punto unico de salida. En modo -Json escribe una sola linea parseable y nada
  mas, porque quien lo llama (el puente) necesita leer el resultado, no prosa.
#>
function Finish {
  param(
    [Parameter(Mandatory = $true)][string]$Estado,
    [Parameter(Mandatory = $true)][string]$Mensaje,
    [int]$Code = 0,
    [string]$Color = 'Gray',
    [hashtable]$Extra
  )
  $script:Log.Add($Mensaje)
  if ($Json) {
    $out = [pscustomobject]@{
      ok      = ($Code -eq 0)
      estado  = $Estado
      mensaje = $Mensaje
      puerto  = $Port
      exe     = $script:ExePath
      salida  = $Code
    }
    if ($Extra) {
      foreach ($k in $Extra.Keys) { $out | Add-Member -NotePropertyName $k -NotePropertyValue $Extra[$k] -Force }
    }
    $out | Add-Member -NotePropertyName pasos -NotePropertyValue $script:Log -Force
    Write-Output ($out | ConvertTo-Json -Compress -Depth 6)
  } else {
    Write-Host ''
    Write-Host "  $Mensaje" -ForegroundColor $Color
    Write-Host ''
  }
  exit $Code
}

# --- Localizar el ejecutable ----------------------------------------------
#
# Antes iba una ruta fija en Program Files; si la app estaba en otro sitio el
# script moria y no habia modo en vivo. Ahora se busca en varios sitios y la
# primera fuente de verdad es la propia app si ya esta corriendo.
function Find-Exe {
  if ($Exe) {
    if (Test-Path -LiteralPath $Exe) { return (Resolve-Path -LiteralPath $Exe).Path }
    throw "No existe el ejecutable indicado: $Exe"
  }

  foreach ($p in @(Get-Process -Name $PROC_NAME -ErrorAction SilentlyContinue)) {
    try { if ($p.Path) { return $p.Path } } catch {}
  }

  # Se construye a mano en vez de con Join-Path: en un equipo donde alguna de
  # esas variables no exista, Join-Path con $null aborta el script entero.
  $bases = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:LOCALAPPDATA,
    "$env:LOCALAPPDATA\Programs"
  ) | Where-Object { $_ }
  foreach ($b in $bases) {
    $c = "$b\LaserPecker Design Space\$EXE_NAME"
    if (Test-Path -LiteralPath $c) { return $c }
  }

  # Ultimo recurso: lo que diga el registro de programas instalados.
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($k in $keys) {
    foreach ($entry in @(Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'LaserPecker' })) {
      if ($entry.InstallLocation) {
        $c = Join-Path $entry.InstallLocation $EXE_NAME
        if (Test-Path -LiteralPath $c) { return $c }
      }
      if ($entry.DisplayIcon) {
        $c = ($entry.DisplayIcon -split ',')[0].Trim('"')
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
      }
    }
  }

  throw 'No se encuentra LaserPecker Design Space. Pasa la ruta con -Exe "C:\...\LaserPecker Design Space.exe"'
}

# --- Estado del depurador -------------------------------------------------
#
# No basta con que el puerto responda 200: el puente necesita una PAGINA con
# webSocketDebuggerUrl, y ademas que sea la ventana principal (la que sirve el
# frontend desde :9898). Un 200 sin targets utiles seria un falso "listo".
function Test-Cdp {
  param([int]$P = $Port)
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$P/json/list" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -ne 200) { return $null }
    $pages = @(($r.Content | ConvertFrom-Json) | Where-Object { $_.type -eq 'page' -and $_.webSocketDebuggerUrl })
    if (-not $pages.Count) { return $null }
    $main = @($pages | Where-Object { $_.url -match ':9898|index\.html' })
    return [pscustomobject]@{ Paginas = $pages.Count; Principal = [bool]$main.Count }
  } catch { return $null }
}

function Wait-Cdp {
  param([int]$Seconds)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $c = Test-Cdp
    if ($c -and $c.Principal) { return $c }
    Start-Sleep -Milliseconds 700
  }
  # Puede haber depurador pero sin la ventana principal montada todavia.
  return (Test-Cdp)
}

# El proceso principal de Electron es el unico sin --type= en su linea de
# comandos; los demas son renderer, gpu, utility y crashpad.
function Get-MainProcess {
  Get-CimInstance Win32_Process -Filter "Name='$EXE_NAME'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' } |
    Select-Object -First 1
}

function Get-DebugPortOf {
  param($Proc)
  if ($Proc -and $Proc.CommandLine -match '--remote-debugging-port=(\d+)') { return [int]$Matches[1] }
  return 0
}

function Test-PortListening {
  param([int]$P)
  $c = Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue
  return [bool]$c
}

<#
  Espera a que no quede NINGUN proceso de la app.

  Es imprescindible antes de relanzar: Electron tiene bloqueo de instancia
  unica, asi que si el proceso viejo aun agoniza, el nuevo arranque le pasa el
  control a el y se cierra -- y el puerto de depuracion nunca se abre, aunque
  todo parezca haber ido bien.
#>
function Wait-AppGone {
  param([int]$Seconds = 20)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $alive = @(Get-Process -Name $PROC_NAME -ErrorAction SilentlyContinue)
    if (-not $alive.Count -and -not (Test-PortListening $APP_PORT)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return (-not @(Get-Process -Name $PROC_NAME -ErrorAction SilentlyContinue).Count)
}

function New-Atajo {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'LaserPecker Design Space (modo en vivo).lnk'
  $existia = Test-Path -LiteralPath $lnk
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $script:ExePath
  $s.Arguments = "--remote-debugging-port=$Port"
  $s.WorkingDirectory = Split-Path -Parent $script:ExePath
  $s.IconLocation = $script:ExePath
  $s.Description = 'Design Space con el modo en vivo del puente Divergency AI'
  $s.Save()
  if ($existia) { Say "  [ok] Atajo actualizado: $lnk" 'Green' }
  else { Say "  [ok] Atajo creado: $lnk" 'Green' }
  Say '       Abre la app desde ahi y el modo en vivo estara activo siempre.' 'Gray'
  return $lnk
}

# --- Empieza el trabajo ---------------------------------------------------

if (-not $Json) {
  Write-Host ''
  Write-Host '  Modo en vivo de Design Space' -ForegroundColor Cyan
  Write-Host '  ----------------------------' -ForegroundColor Cyan
  Write-Host ''
}

try {
  $script:ExePath = Find-Exe
} catch {
  Finish -Estado 'sin-exe' -Mensaje $_.Exception.Message -Code 1 -Color Red
}
Say "  [ok] Ejecutable: $($script:ExePath)" 'Gray'

$atajo = $null
if ($CrearAtajo) {
  try { $atajo = New-Atajo } catch { Say "  [!!] No se pudo crear el atajo: $($_.Exception.Message)" 'Yellow' }
}

$main = Get-MainProcess
$portInUse = Get-DebugPortOf $main

# 1. ¿Ya esta todo listo? Entonces no se toca la app: cerrarla por gusto es la
#    forma mas facil de que alguien pierda un diseno sin guardar.
if ($main -and $portInUse -eq $Port) {
  Say "  [..] La app ya corre con el puerto $Port; comprobando el depurador..." 'Gray'
  $cdp = Wait-Cdp -Seconds 15
  if ($cdp -and $cdp.Principal) {
    Finish -Estado 'ya-activo' -Code 0 -Color Green `
      -Mensaje "Modo en vivo ya activo en el puerto $Port. No se ha reiniciado nada." `
      -Extra @{ reiniciada = $false; paginas = $cdp.Paginas; atajo = $atajo }
  }
  Say '  [!!] Tiene el puerto en la linea de comandos pero el depurador no responde; se reinicia.' 'Yellow'
} elseif ($main -and $portInUse) {
  Say "  [!!] La app corre con el puerto $portInUse, no con el $Port; se reinicia." 'Yellow'
}

# 2. Que el puerto no lo tenga cogido otra cosa. Si lo esta, reiniciar la app
#    no arreglaria nada y encima habriamos cerrado la app para nada.
if (-not $main -or $portInUse -ne $Port) {
  $appPids = @(Get-Process -Name $PROC_NAME -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $busy = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $appPids -notcontains $_.OwningProcess })
  if ($busy.Count) {
    $owner = 'desconocido'
    try { $owner = (Get-Process -Id $busy[0].OwningProcess -ErrorAction Stop).ProcessName } catch {}
    Finish -Estado 'puerto-ocupado' -Code 1 -Color Red `
      -Mensaje "El puerto $Port ya lo esta usando otro programa ($owner, PID $($busy[0].OwningProcess)). Cierralo o usa -Port con otro numero." `
      -Extra @{ ocupadoPor = $owner; ocupadoPid = $busy[0].OwningProcess }
  }
}

# 3. Cerrar la instancia actual, con cuidado.
if ($main) {
  Say ''
  Say '  AVISO: se va a cerrar LaserPecker Design Space.' 'Yellow'
  Say '  Guarda tu trabajo antes de continuar (Ctrl+S).' 'Yellow'
  Say ''

  if (-not $Yes -and -not $Force) {
    if ($Json) {
      # Sin consola no se puede preguntar, y cerrar la app por iniciativa
      # propia no es aceptable: quien llama tiene que pedirlo explicitamente.
      Finish -Estado 'confirmacion-necesaria' -Code 3 -Color Yellow `
        -Mensaje 'Hay que cerrar y reabrir Design Space; vuelve a pedirlo confirmando (-Yes).'
    }
    $answer = Read-Host '  Escribe "si" para cerrarla y reabrirla con el puerto de depuracion'
    if ($answer -notmatch '^\s*(si|si|s|yes|y)\s*$') {
      Finish -Estado 'cancelado' -Code 3 -Color Green -Mensaje 'Cancelado. No se ha tocado nada.'
    }
  }

  Say '  [..] Pidiendo cierre ordenado...' 'Gray'
  foreach ($p in @(Get-Process -Name $PROC_NAME -ErrorAction SilentlyContinue)) {
    try { if ($p.MainWindowHandle -ne 0) { $p.CloseMainWindow() | Out-Null } } catch {}
  }

  if (-not (Wait-AppGone -Seconds 20)) {
    if ($Force) {
      Say '  [!!] Sigue abierta; se fuerza el cierre (-Force).' 'Yellow'
      foreach ($p in @(Get-Process -Name $PROC_NAME -ErrorAction SilentlyContinue)) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
      }
      if (-not (Wait-AppGone -Seconds 10)) {
        Finish -Estado 'no-cerro' -Code 2 -Color Red -Mensaje 'No se pudo cerrar la app ni forzandolo.'
      }
    } else {
      Finish -Estado 'pendiente-de-guardar' -Code 2 -Color Yellow `
        -Mensaje 'La app sigue abierta: seguramente esta preguntando por el trabajo sin guardar. Responde en su ventana y vuelve a intentarlo.'
    }
  }
  Say '  [ok] Cerrada.' 'Green'
}

# 4. Arrancar con el puerto abierto.
Say "  [..] Arrancando con el puerto de depuracion $Port..." 'Gray'
try {
  Start-Process -FilePath $script:ExePath -ArgumentList "--remote-debugging-port=$Port" `
    -WorkingDirectory (Split-Path -Parent $script:ExePath)
} catch {
  Finish -Estado 'no-arranco' -Code 1 -Color Red -Mensaje "No se pudo arrancar la app: $($_.Exception.Message)"
}

$cdp = Wait-Cdp -Seconds 60

if ($cdp -and $cdp.Principal) {
  Finish -Estado 'activo' -Code 0 -Color Green `
    -Mensaje "Modo en vivo activo en el puerto $Port. El puente ya puede registrar y grabar." `
    -Extra @{ reiniciada = $true; paginas = $cdp.Paginas; atajo = $atajo }
} elseif ($cdp) {
  Finish -Estado 'sin-ventana' -Code 1 -Color Yellow `
    -Mensaje "El depurador responde en $Port pero no expone la ventana principal todavia. Espera a que la app termine de cargar y vuelve a comprobarlo." `
    -Extra @{ reiniciada = $true; paginas = $cdp.Paginas; atajo = $atajo }
} else {
  Finish -Estado 'sin-depurador' -Code 1 -Color Red `
    -Mensaje "La app arranco pero el depurador no responde en el puerto $Port. Comprueba que no haya quedado otra instancia abierta." `
    -Extra @{ reiniciada = $true; atajo = $atajo }
}
