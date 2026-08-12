'use strict'

// Arranque de LaserPecker Design Space con el puerto de depuracion abierto.
//
// El modo en vivo depende de un argumento de arranque (--remote-debugging-port),
// asi que no se puede activar sobre una app ya abierta con el icono normal: hay
// que cerrarla y reabrirla. Eso lo hace launch-app.ps1, y este modulo es el
// puente hacia el, para que la landing pueda ofrecer un boton en vez de mandar
// al usuario a una terminal.
//
// La logica de lanzamiento vive SOLO en el .ps1: aqui no se duplica nada. Si se
// reimplementara en Node habria dos verdades sobre como abrir la app, y una de
// las dos se quedaria vieja.

const { execFile } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const resources = require('./resources')

// En el repo es el .ps1 de al lado; en el .exe viaja embebido y se extrae a la
// carpeta de datos del usuario, porque `powershell -File` necesita un fichero.
const scriptPath = () => resources.filePath('launch-app.ps1')

const APP_PORT = 9898 // el Express propio de Design Space
const TIMEOUT_MS = 150000 // cierre ordenado (20 s) + arranque y carga (60 s) con margen

const EXE_NAME = 'LaserPecker Design Space.exe'

/** Rutas donde suele acabar instalada la app, en orden de probabilidad. */
function exeCandidates() {
  const dirs = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.LOCALAPPDATA,
  ].filter(Boolean)
  return dirs.map((d) => path.join(d, 'LaserPecker Design Space', EXE_NAME))
}

let exeCache
/**
 * Ruta del ejecutable, o null si no aparece.
 *
 * Se cachea el hallazgo pero no el fallo: si no estaba y el usuario lo instala,
 * no hace falta reiniciar el puente para que empiece a verlo.
 */
function findExe() {
  if (exeCache) return exeCache
  for (const c of exeCandidates()) {
    if (fs.existsSync(c)) {
      exeCache = c
      return c
    }
  }
  return null
}

/**
 * ¿Esta la app abierta?
 *
 * Se deduce de su propio servidor Express en :9898, que solo escucha mientras
 * la app corre. Es una sonda TCP de milisegundos, y la landing pregunta el
 * estado cada pocos segundos: mirar la lista de procesos aqui costaria un
 * proceso nuevo en cada sondeo.
 */
function appRunning(timeoutMs = 400) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const done = (value) => {
      sock.destroy()
      resolve(value)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
    sock.connect(APP_PORT, '127.0.0.1')
  })
}

/** El resultado del .ps1 sale como una sola linea JSON; se coge la ultima. */
function parseResult(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i])
    } catch {}
  }
  return null
}

// Cerrar y reabrir la app dos veces a la vez dejaria a Electron peleandose con
// su propio bloqueo de instancia unica, asi que la operacion se serializa.
let running = null

/**
 * Deja la app corriendo con el depurador abierto.
 *
 * Es idempotente: si ya lo esta, el script no toca nada y devuelve `ya-activo`.
 *
 * @param {object} [opts]
 * @param {number}  [opts.port]     Puerto de depuracion (el del puente).
 * @param {boolean} [opts.confirm]  Autoriza cerrar la app si hace falta. Sin
 *                                  esto el script se niega y pide confirmacion,
 *                                  porque puede haber trabajo sin guardar.
 * @param {boolean} [opts.force]    Mata el proceso si no cierra por las buenas.
 * @param {boolean} [opts.shortcut] Crea el atajo de Escritorio con el puerto ya puesto.
 * @returns {Promise<object>} `{ ok, estado, mensaje, ... }`
 */
function enableLive(opts = {}) {
  if (running) return running

  const port = Number(opts.port) || 9222

  running = new Promise((resolve) => {
    if (os.platform() !== 'win32') {
      return resolve({ ok: false, estado: 'no-windows', mensaje: 'El modo en vivo solo se puede activar en Windows' })
    }

    // Se resuelve aqui y no al cargar el modulo porque en el .exe esto escribe
    // el .ps1 en disco: no interesa hacerlo en cada arranque del puente, solo
    // cuando de verdad hay que lanzar la app.
    let script
    try {
      script = scriptPath()
    } catch (err) {
      return resolve({ ok: false, estado: 'sin-script', mensaje: `No se pudo preparar launch-app.ps1: ${err.message}` })
    }
    if (!fs.existsSync(script)) {
      return resolve({ ok: false, estado: 'sin-script', mensaje: `No se encuentra launch-app.ps1 en ${script}` })
    }

    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', String(port), '-Json']
    if (opts.confirm) args.push('-Yes')
    if (opts.force) args.push('-Force')
    if (opts.shortcut) args.push('-CrearAtajo')

    execFile('powershell.exe', args, { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      const parsed = parseResult(stdout)
      if (parsed) return resolve(parsed)
      // Sin JSON que leer, el fallo es del propio lanzamiento del script.
      const detail = String(stderr || '').trim() || String(stdout || '').trim() || (err && err.message) || 'sin salida'
      resolve({
        ok: false,
        estado: err && err.killed ? 'tiempo-agotado' : 'fallo-script',
        mensaje:
          err && err.killed
            ? 'El lanzador tardo demasiado; comprueba si Design Space se quedo preguntando por el trabajo sin guardar.'
            : `El lanzador fallo: ${detail.slice(0, 400)}`,
      })
    })
  }).finally(() => {
    running = null
  })

  return running
}

/** ¿Hay ahora mismo una activacion en curso? La landing lo usa para no repetir. */
function isBusy() {
  return running !== null
}

module.exports = { enableLive, appRunning, findExe, isBusy, scriptPath }
