'use strict'

// De donde salen los recursos y donde se escribe, segun como se este corriendo.
//
// Hay dos formas de arrancar el puente y las dos tienen que comportarse igual:
//
//   node src/server.js        -> los recursos estan al lado, en el repo
//   DivergencyGrabadoraLaser.exe    -> van dentro del propio ejecutable (Node SEA)
//
// En el .exe no hay repo que leer: la landing, los bitmaps del logo y
// launch-app.ps1 viajan embebidos y se piden a la API de SEA. Y lo que se
// escribe (plantillas.json) no puede ir al lado del ejecutable, porque puede
// estar en Descargas o en Program Files, asi que va a %LOCALAPPDATA%.
//
// Todo el resto del codigo pide los recursos por aqui y no se entera de en cual
// de los dos mundos esta.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let sea = null
try {
  sea = require('node:sea')
} catch {
  // Node sin node:sea (antes de 20.12): entonces esto solo puede ser el repo.
}

/** ¿Estamos dentro del ejecutable de un solo fichero? */
const packaged = Boolean(sea && typeof sea.isSea === 'function' && sea.isSea())

/**
 * Raiz del repo, subiendo hasta encontrar la landing.
 *
 * No vale `path.join(__dirname, '..')` a secas: este fichero se lee tal cual
 * desde `src/`, pero el bundle del .exe lo mete en `build/out/`, y en un Node
 * suelto (sin SEA) ese `..` apuntaria a `build/`. Se busca la marca.
 */
function findRoot() {
  let dir = __dirname
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'public', 'index.html'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return path.join(__dirname, '..')
}

const ROOT = packaged ? null : findRoot()

/**
 * Carpeta de datos del usuario: lo que el puente escribe y quiere conservar.
 *
 * En el repo es la raiz, para no cambiar nada de como se venia usando. En el
 * .exe es %LOCALAPPDATA%, que siempre es escribible y sobrevive a mover o
 * reemplazar el ejecutable.
 */
const dataDir = packaged
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PlacasDivergencyAI')
  : ROOT

/** Ruta de un fichero de datos del usuario, con la carpeta ya creada. */
function dataFile(name) {
  if (packaged) fs.mkdirSync(dataDir, { recursive: true })
  return path.join(dataDir, name)
}

/**
 * Contenido de un recurso embebido, o null si no existe.
 *
 * `rel` va siempre con barras normales ('public/index.html'): es la clave
 * exacta con la que se embebio en el blob de SEA.
 */
function read(rel) {
  const key = String(rel).replace(/\\/g, '/')
  if (packaged) {
    try {
      return Buffer.from(sea.getRawAsset(key))
    } catch {
      return null // no embebido: para la landing es un 404 normal
    }
  }
  try {
    return fs.readFileSync(path.join(ROOT, key))
  } catch {
    return null
  }
}

/** Igual que `read`, pero un recurso que falta es un error de empaquetado. */
function readOrThrow(rel) {
  const buf = read(rel)
  if (!buf) throw new Error(`Falta el recurso ${rel}${packaged ? ' en el ejecutable' : ` en ${ROOT}`}`)
  return buf
}

/**
 * Una ruta de disco de verdad para un recurso, para lo que no se puede leer en
 * memoria: `powershell -File` necesita un fichero.
 *
 * En el .exe se extrae a la carpeta de datos del usuario -- no a %TEMP%, que es
 * escribible por cualquiera de la maquina y esto se va a ejecutar. Se reescribe
 * en cada arranque para que una version vieja no sobreviva a una actualizacion.
 */
function filePath(rel) {
  if (!packaged) return path.join(ROOT, rel)

  const out = path.join(dataDir, 'bin', path.basename(rel))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, readOrThrow(rel))
  return out
}

module.exports = { packaged, read, readOrThrow, filePath, dataDir, dataFile, ROOT }
