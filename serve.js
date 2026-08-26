'use strict'

// Sirve la landing de descarga: esta carpeta tal cual, con el .exe listo para
// bajar.
//
//   node web/serve.js            -> http://127.0.0.1:8080  (solo este equipo)
//   node web/serve.js --lan      -> tambien desde la red local, para que otro
//                                   se lo descargue sin pasar por USB
//   node web/serve.js --port 9000
//
// Es de solo lectura y no comparte nada de fuera de web/: el puente de verdad
// (el que escribe ficheros y dispara el laser) es otro proceso y sigue escuchando
// solo en loopback.

const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const DIR = __dirname
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const valor = (name, alt) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : alt
}

const PORT = Number(valor('port', process.env.PORT || 8080))
// Salir de loopback se pide a mano: compartir un ejecutable con la red es una
// decision, no un valor por defecto.
const HOST = flag('lan') ? '0.0.0.0' : '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.apk': 'application/vnd.android.package-archive',
}

/** Direcciones IPv4 de la maquina, para decir por donde entrar desde la red. */
function ips() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))

  // Se normaliza ANTES de comprobar la salida del directorio: '/a/../../x' pasa
  // cualquier filtro que mire la cadena en bruto.
  const clean = path.posix.normalize('/' + rel.replace(/\\/g, '/')).slice(1)
  const target = path.join(DIR, clean)
  if (!clean || clean.startsWith('..') || !target.startsWith(DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Prohibido')
  }

  let st
  try {
    st = await fsp.stat(target)
    if (st.isDirectory()) throw new Error('directorio')
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('No encontrado')
  }

  const ext = path.extname(target).toLowerCase()
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    // La landing y version.json cambian en cada build; el .exe se cachea por
    // nombre y no interesa que el navegador sirva uno viejo tampoco.
    'Cache-Control': 'no-store',
  }
  // Que el navegador no intente "abrir" el ejecutable/apk en una pestaña.
  if (ext === '.exe' || ext === '.apk') headers['Content-Disposition'] = `attachment; filename="${path.basename(target)}"`

  if (req.method === 'HEAD') {
    res.writeHead(200, headers)
    return res.end()
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Metodo no permitido')
  }

  res.writeHead(200, headers)
  // Streaming: el .exe son 90 MB y no tiene sentido cargarlo en memoria.
  fs.createReadStream(target).pipe(res)
})

server.listen(PORT, HOST, () => {
  const exe = path.join(DIR, 'descargas', 'DivergencyGrabadoraLaser.exe')
  console.log('')
  console.log('  Landing de descarga')
  console.log('  -------------------')
  console.log(`  http://127.0.0.1:${PORT}`)
  if (HOST === '0.0.0.0') for (const ip of ips()) console.log(`  http://${ip}:${PORT}   (desde la red local)`)
  console.log('')
  if (fs.existsSync(exe)) {
    console.log(`  Ejecutable: ${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB`)
  } else {
    console.log('  [!!] Todavia no hay ejecutable que descargar: construyelo con')
    console.log('       powershell -ExecutionPolicy Bypass -File build\\build.ps1')
  }
  console.log('')
  console.log('  Ctrl+C para parar.')
  console.log('')
})
