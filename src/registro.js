'use strict'

// El puesto de registro: la pagina que abre la gente al escanear el QR.
//
// Es OTRO servidor, y eso es lo importante. El puente escucha solo en loopback
// a proposito -- escribe ficheros arbitrarios en disco y dispara un laser --,
// asi que no se le puede abrir a la red por muy comodo que fuera. Este proceso
// atiende dos rutas y no sabe hacer nada mas:
//
//   GET  /          el formulario
//   POST /registro  nombre, celular y correo -> un numero de turno
//
// No lee ficheros del disco por lo que pida la URL, no toca Design Space, no
// tiene forma de llegar a la maquina. Lo peor que puede hacer alguien de la red
// es apuntarse muchas veces, y para eso esta el limite por IP.
//
// Se abre a mano desde la landing (nunca solo): compartir algo con la red es
// una decision, igual que el --lan de web/serve.js.

const http = require('node:http')
const os = require('node:os')
const cola = require('./cola')
const resources = require('./resources')

const DEFAULT_PORT = Number(process.env.LP_REGISTRO_PORT) || 7789
const MAX_BODY = 4 * 1024 // un formulario de tres campos; nada legitimo se acerca

// Limite por IP: en un evento cada movil trae la suya, asi que esto no estorba a
// nadie y evita que una pestana en bucle llene la cola.
const VENTANA_MS = 10 * 60 * 1000
const MAX_POR_IP = 15

let server = null
let desde = null
let puerto = null
const golpes = new Map()

/** Direcciones IPv4 de la maquina, la mas probable primero. */
function ips() {
  const lista = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)

  // El wifi de casa o del sitio suele ser 192.168.x.x; las 10.x y 172.x son
  // corporativas o de VPN y a menudo no las alcanza el movil de un visitante.
  const rango = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3)
  return lista.sort((a, b) => rango(a) - rango(b))
}

function limitado(ip) {
  const ahora = Date.now()
  const previos = (golpes.get(ip) || []).filter((t) => ahora - t < VENTANA_MS)
  if (previos.length >= MAX_POR_IP) {
    golpes.set(ip, previos)
    return true
  }
  previos.push(ahora)
  golpes.set(ip, previos)
  // La tabla no puede crecer sin fin: se limpia cuando ya abulta.
  if (golpes.size > 500) for (const [k, v] of golpes) if (!v.some((t) => ahora - t < VENTANA_MS)) golpes.delete(k)
  return false
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        const err = new Error('El formulario llego demasiado grande')
        err.status = 413
        reject(err)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Acepta JSON y tambien el envio normal de un formulario HTML. */
function parsear(texto, tipo) {
  if (/application\/json/i.test(tipo || '')) return JSON.parse(texto)
  const datos = {}
  for (const [k, v] of new URLSearchParams(texto)) datos[k] = v
  return datos
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function atender(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'registro'}`)
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = resources.read('public/registro.html')
    if (!html) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Falta la pagina de registro')
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Nada de esta pagina sale a internet ni carga nada de fuera.
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    })
    return res.end(html)
  }

  if (req.method === 'GET' && url.pathname === '/logo.png') {
    const logo = resources.read('assets/divergency-logo-original.png')
    if (!logo) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' })
    return res.end(logo)
  }

  if (req.method === 'POST' && url.pathname === '/registro') {
    if (limitado(ip)) return json(res, 429, { ok: false, error: 'Demasiados registros desde este telefono; espera un momento' })

    let datos
    try {
      datos = parsear(await leerCuerpo(req), req.headers['content-type'])
    } catch (err) {
      // Se contesta antes de cortar: un socket cerrado a secas le sale al movil
      // como "no hay conexion", que manda a mirar el wifi en vez del formulario.
      json(res, err.status || 400, { ok: false, error: err.message })
      if (err.status === 413) req.destroy()
      return
    }

    try {
      const r = cola.add(datos, { ip })
      console.log(
        `[${new Date().toISOString()}] registro #${r.turno} "${r.registro.nombre}"` +
          `${r.repetido ? ' (ya estaba en la cola)' : ''} desde ${ip}`
      )
      return json(res, 200, {
        ok: true,
        turno: r.turno,
        delante: r.delante,
        repetido: r.repetido,
        nombre: r.registro.nombre,
      })
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message })
    }
  }

  // Cualquier otra cosa no existe: aqui no se sirven ficheros por ruta.
  json(res, 404, { ok: false, error: 'No encontrado' })
}

/** ¿Esta abierto el puesto de registro? */
function activo() {
  return Boolean(server && server.listening)
}

function estado() {
  const r = cola.resumen()
  return {
    activo: activo(),
    puerto: activo() ? puerto : DEFAULT_PORT,
    desde,
    ips: ips(),
    url: activo() && ips().length ? `http://${ips()[0]}:${puerto}` : null,
    urls: activo() ? ips().map((ip) => `http://${ip}:${puerto}`) : [],
    cola: r,
  }
}

/**
 * Abre el puesto de registro a la red local.
 *
 * @param {{port?: number}} [opts]
 * @returns {Promise<{ok: boolean, error?: string, ...}>}
 */
function start(opts = {}) {
  if (activo()) return Promise.resolve({ ok: true, yaEstaba: true, ...estado() })

  const port = Number(opts.port) || DEFAULT_PORT
  if (!ips().length)
    return Promise.resolve({
      ok: false,
      error: 'Este equipo no esta en ninguna red: conectalo al wifi para que los telefonos puedan llegar al formulario',
    })

  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      atender(req, res).catch((err) => {
        console.error('registro:', err)
        try {
          json(res, 500, { ok: false, error: 'Error en el puesto de registro' })
        } catch {}
      })
    })

    s.on('error', (err) => {
      server = null
      resolve({
        ok: false,
        error:
          err.code === 'EADDRINUSE'
            ? `El puerto ${port} ya esta ocupado por otro programa; cierralo o cambia LP_REGISTRO_PORT`
            : err.message,
      })
    })

    // 0.0.0.0 y no loopback: si no, el movil de quien escanea no llega.
    s.listen(port, '0.0.0.0', () => {
      server = s
      puerto = port
      desde = new Date().toISOString()
      console.log(`[${new Date().toISOString()}] puesto de registro abierto en ${ips().map((ip) => `http://${ip}:${port}`).join('  ')}`)
      resolve({ ok: true, yaEstaba: false, ...estado() })
    })
  })
}

/** Cierra el puesto: la cola se conserva, solo deja de aceptar registros. */
function stop() {
  if (!activo()) return Promise.resolve({ ok: true, yaEstaba: true, ...estado() })
  return new Promise((resolve) => {
    const s = server
    server = null
    s.close(() => {
      console.log(`[${new Date().toISOString()}] puesto de registro cerrado`)
      resolve({ ok: true, yaEstaba: false, ...estado() })
    })
    // Un movil con la pagina abierta mantiene la conexion viva; sin esto el
    // cierre se queda esperando a que se aburra.
    s.closeIdleConnections?.()
  })
}

module.exports = { start, stop, estado, activo, ips, DEFAULT_PORT }
