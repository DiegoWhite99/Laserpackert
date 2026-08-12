'use strict'

// ¿Esta la maquina enchufada y encendida?
//
// Design Space es la autoridad sobre si esta CONECTADA (eso lo mira cdp.js),
// pero cuando dice que no, hace falta saber por que: la maquina no esta, o esta
// pero la app no se ha enlazado. Eso se puede ver a nivel de sistema.
//
// La LaserPecker se presenta como un USB-serie de WCH (CH340 / CH9102, VID
// 1A86); en este equipo aparece como "USB-Enhanced-SERIAL CH9102 (COM4)". El
// chip vive dentro de la maquina, asi que solo enumera si esta enchufada Y
// encendida, que es justo lo que interesa saber.
//
// OJO: por Bluetooth no hay puerto serie, asi que `present: false` no prueba que
// la maquina no este; es una pista para explicar un fallo, nunca un veredicto.
// Quien manda es lo que diga la app.

const { execFile } = require('node:child_process')

const TTL_MS = 5000 // la landing sondea cada 8 s; con esto no se dispara un proceso por sondeo
const PS_TIMEOUT = 6000

const PS = `
$ErrorActionPreference='SilentlyContinue'
$d = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
  Where-Object { $_.InstanceId -match 'VID_1A86' -or $_.FriendlyName -match 'CH340|CH910|LaserPecker' } |
  Select-Object -First 1
if ($d) {
  [pscustomobject]@{ present=$true; name=$d.FriendlyName; status=$d.Status; id=$d.InstanceId } | ConvertTo-Json -Compress
} else {
  '{"present":false}'
}
`

let cache = null // { at, value }
let inflight = null

function probe() {
  if (inflight) return inflight
  inflight = new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ present: null, motivo: 'solo se puede comprobar en Windows' })
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS],
      { timeout: PS_TIMEOUT, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({ present: null, motivo: 'no se pudo consultar el sistema' })
        let parsed = null
        try {
          parsed = JSON.parse(String(stdout).trim() || 'null')
        } catch {}
        if (!parsed) return resolve({ present: null, motivo: 'respuesta ilegible del sistema' })
        const m = /\((COM\d+)\)/.exec(parsed.name || '')
        resolve({
          present: Boolean(parsed.present),
          port: m ? m[1] : null,
          name: parsed.name || null,
          // Un dispositivo presente pero con problema de driver no sirve.
          driverOk: parsed.present ? parsed.status === 'OK' : null,
          status: parsed.status || null,
        })
      }
    )
  }).finally(() => {
    inflight = null
  })
  return inflight
}

/**
 * Estado del cacharro a nivel de sistema, cacheado.
 *
 * La primera vez se espera; despues se devuelve lo cacheado al instante y, si
 * ya esta viejo, se refresca por detras. Asi /api/status nunca se queda
 * esperando a que arranque un powershell.
 */
async function status() {
  const now = Date.now()
  if (!cache) {
    const value = await probe()
    cache = { at: Date.now(), value }
    return { ...value, edadMs: 0 }
  }
  if (now - cache.at > TTL_MS && !inflight) {
    probe().then((value) => {
      cache = { at: Date.now(), value }
    })
  }
  return { ...cache.value, edadMs: now - cache.at }
}

module.exports = { status }
