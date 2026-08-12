'use strict'

// Puente HTTP entre la landing y LaserPecker Design Space.
//
// La app no expone ninguna API propia: su servidor Express en :9898 solo
// sirve el frontend y responde 404 a todo lo demas. Este proceso es el
// receptor que faltaba -- acepta el POST, materializa un .lp2 en la carpeta
// de proyectos y lo registra en la galeria.

const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { buildLp2 } = require('./lp2')
const { buildBadge } = require('./badge')
const { registerProject, listProjects, findProject, deleteProjects } = require('./db')
const { getTemplate, allTemplates, saveTemplate, deleteTemplate, DEFAULT_TEMPLATE, layout } = require('./templates')
const cdp = require('./cdp')
const launcher = require('./launcher')
const machine = require('./machine')
const resources = require('./resources')
const cola = require('./cola')
const registro = require('./registro')
const qr = require('./qr')

const PORT = Number(process.env.PORT) || 7788
const PROJECT_DIR = process.env.LP_PROJECT_DIR || 'D:\\Documentos\\LaserPecker\\project'
const MAX_BODY = 25 * 1024 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * El puente escribe ficheros y ademas dispara el laser, asi que no puede
 * atender a cualquier pagina que el usuario tenga abierta en el navegador.
 *
 * La landing se sirve desde este mismo origen, asi que no hace falta ningun
 * CORS: basta con rechazar lo que venga de fuera. Escuchar solo en loopback
 * protege de la red local, pero no del navegador, que si puede alcanzarnos
 * desde cualquier web.
 *
 * Sin cabecera Origin (curl, Invoke-RestMethod, scripts) se deja pasar: eso
 * no lo puede originar una pagina web ajena.
 */
function originAllowed(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '')
  if (!LOCAL_HOSTS.has(host)) return false // corta el DNS rebinding

  const origin = req.headers.origin
  if (!origin) return true
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error(`Cuerpo demasiado grande (limite ${MAX_BODY / 1024 / 1024} MB)`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function decodeImage(value) {
  if (!value) return null
  // Acepta tanto data URI como base64 pelado.
  const comma = value.indexOf(',')
  const base64 = value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value
  const buf = Buffer.from(base64, 'base64')
  if (!buf.length) throw new Error('La imagen llego vacia o con base64 invalido')
  return buf
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`Valor numerico invalido: ${value}`)
  return n
}

function safeFileName(name) {
  return String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim()
    .slice(0, 80) || 'Untitled'
}

/**
 * Materializa un .lp2 en disco y lo registra en la galeria.
 *
 * Con live=true el registro lo hace la propia app via CDP
 * (window.Project.StorageableAsync), asi que la galeria se actualiza sin
 * reiniciarla. Si el depurador no esta accesible se cae a escribir el
 * SQLite directamente, que funciona igual pero exige reinicio.
 *
 * @returns {{path: string, galleryRegistered: boolean, via: string, galleryError?: string}}
 */
async function persist(result, projectName, live) {
  await fsp.mkdir(PROJECT_DIR, { recursive: true })
  const filePath = path.join(PROJECT_DIR, `${result.fileId}.lp2`)
  await fsp.writeFile(filePath, result.buffer)

  const common = {
    fileId: result.fileId,
    name: projectName,
    widthMm: result.widthMm,
    heightMm: result.heightMm,
    previewDataUri: result.previewDataUri,
    filePath,
    createTime: result.createTime,
  }

  let outcome
  if (live) {
    try {
      const r = await cdp.registerViaApp(common)
      outcome = r?.ok
        ? { galleryRegistered: true, via: 'app' }
        : { galleryRegistered: false, via: 'app', galleryError: r?.error || 'la app rechazo el registro' }
    } catch (err) {
      outcome = { galleryRegistered: false, via: 'app', galleryError: err.message }
    }
    // Si la app no pudo registrarlo, no se pierde el trabajo: se escribe el
    // SQLite a mano y solo hara falta reiniciar para verlo.
    if (!outcome.galleryRegistered) {
      const reg = registerProject(common)
      if (reg.registered) outcome = { galleryRegistered: true, via: 'sqlite-fallback', galleryError: outcome.galleryError }
    }
  } else {
    const reg = registerProject(common)
    outcome = { galleryRegistered: reg.registered, via: 'sqlite', galleryError: reg.reason }
  }

  console.log(
    `[${new Date().toISOString()}] creado ${path.basename(filePath)} "${projectName}" ` +
      `(${result.widthMm.toFixed(2)}x${result.heightMm.toFixed(2)} mm) ` +
      `galeria=${outcome.galleryRegistered ? outcome.via : 'NO (' + outcome.galleryError + ')'}`
  )

  return { path: filePath, ...outcome }
}

/**
 * Piezas generadas en esta sesion: id -> con que se generaron.
 *
 * Sirve para una comprobacion que solo se puede hacer aqui: cuando la app abre
 * su aviso de verificacion antes de grabar, lista los parametros que va a
 * aplicar, y se pueden cruzar con los que se metieron en la pieza. Si no
 * cuadran, se cancela en vez de quemar la pieza con otra potencia.
 */
const recientes = new Map()
const MAX_RECIENTES = 100

/**
 * Ultima conexion vista con los ojos de la app.
 *
 * Design Space solo monta su capa de dispositivo en el lienzo: desde la galeria
 * no hay forma de saber si hay maquina enlazada, y su store no lo guarda
 * (comprobado: `currentDevice` sigue vacio con la maquina conectada). Asi que lo
 * recuerda el puente, con la hora, para que la landing pueda decir "estaba
 * conectada hace 20 s" en vez de un "no lo se" a secas. Con la hora, porque un
 * recuerdo sin fecha se acaba presentando como una lectura del momento.
 */
let ultimaConexion = null

function recordar(id, datos) {
  recientes.set(id, datos)
  // Cola sencilla: los Map conservan el orden de insercion.
  if (recientes.size > MAX_RECIENTES) recientes.delete(recientes.keys().next().value)
}

/** Las plantillas tal como las pinta la landing, base primero. */
function listaPlantillas() {
  return allTemplates().map((t) => ({
    id: t.id,
    label: t.label,
    material: t.material,
    logoPower: t.logo.printPower,
    logoDepth: t.logo.printDepth,
    textPower: t.text.printPower,
    textDepth: t.text.printDepth,
    fontFamily: t.text.fontFamily,
    // Las propias se pueden borrar; las base no.
    custom: Boolean(t.custom),
    base: t.base || null,
  }))
}

/** Pares potencia/profundidad de una pieza, tal como los vera el aviso. */
function paresEsperados(id) {
  const r = recientes.get(id)
  if (!r) return null
  const t = getTemplate(r.template)
  const pares = [
    { potencia: r.laser.textPower ?? t.text.printPower, profundidad: r.laser.textDepth ?? t.text.printDepth },
    { potencia: r.laser.power ?? t.logo.printPower, profundidad: r.laser.depth ?? t.logo.printDepth },
  ]
  return pares.filter((p) => Number.isFinite(p.potencia) && Number.isFinite(p.profundidad))
}

function parseNames(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/\r?\n|;/)
  const seen = new Set()
  const names = []
  const duplicates = []
  for (const raw of list) {
    const name = String(raw).trim().replace(/\s+/g, ' ')
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) {
      duplicates.push(name)
      continue
    }
    seen.add(key)
    names.push(name)
  }
  return { names, duplicates }
}

/**
 * De donde salen los nombres de un lote: de la lista escrita a mano o de la
 * cola del registro por QR.
 *
 * Con turnos NO se descartan los repetidos. Escribir dos veces el mismo nombre
 * en el area de texto es un error de dedo, pero dos personas distintas que se
 * llaman igual son dos placas, y cada una espera con su numero en la mano.
 *
 * @returns {{entradas: Array<{name: string, turno: number|null}>, duplicates: string[], faltan: number[]}}
 */
function entradasDelLote(spec) {
  const turnos = Array.isArray(spec.turnos) ? spec.turnos.map(Number).filter(Number.isFinite) : []
  if (!turnos.length) {
    const { names, duplicates } = parseNames(spec.names)
    return { entradas: names.map((name) => ({ name, turno: null })), duplicates, faltan: [] }
  }

  const porTurno = new Map(cola.list().map((r) => [r.turno, r]))
  const entradas = []
  const faltan = []
  for (const t of turnos) {
    const r = porTurno.get(t)
    if (r) entradas.push({ name: r.nombre, turno: t })
    else faltan.push(t)
  }
  return { entradas, duplicates: [], faltan }
}

/** Lote de placas: una por nombre, con el logo Divergency AI fijo. */
async function handleBadges(req, res) {
  const raw = await readBody(req)
  let spec
  try {
    spec = JSON.parse(raw.toString('utf8'))
  } catch {
    return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
  }

  const { entradas, duplicates, faltan } = entradasDelLote(spec)
  if (!entradas.length)
    return sendJson(res, 400, {
      ok: false,
      error: faltan.length ? 'Esos turnos ya no estan en la cola' : 'No llego ningun nombre',
    })
  if (entradas.length > 200)
    return sendJson(res, 400, { ok: false, error: `Demasiados nombres (${entradas.length}); el limite es 200 por lote` })

  // Los parametros invalidos son culpa de quien llama: 400, no 500.
  let laser, template
  try {
    template = getTemplate(spec.template).id
    laser = {
      power: numberOrUndefined(spec.power),
      depth: numberOrUndefined(spec.depth),
      textPower: numberOrUndefined(spec.textPower),
      textDepth: numberOrUndefined(spec.textDepth),
      dpi: numberOrUndefined(spec.dpi),
      materialName: spec.materialName,
    }
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message })
  }

  // Modo en vivo: por defecto se intenta si el depurador esta accesible.
  const live = spec.live === undefined ? await cdp.isAvailable() : Boolean(spec.live)

  const created = []
  const failed = []

  for (const { name, turno } of entradas) {
    try {
      const result = buildBadge({ name, template, laser })
      const saved = await persist(result, name, live)
      recordar(result.fileId, { name, template, laser })
      created.push({
        name,
        turno,
        id: result.fileId,
        path: saved.path,
        template: result.template,
        widthMm: Number(result.widthMm.toFixed(2)),
        heightMm: Number(result.heightMm.toFixed(2)),
        galleryRegistered: saved.galleryRegistered,
        via: saved.via,
        // Sin esto el motivo del fallo se pierde y el aviso final solo
        // puede decir "desconocido", que es justo cuando mas falta hace.
        galleryError: saved.galleryError,
      })
    } catch (err) {
      failed.push({ name, turno, error: err.message })
    }
  }

  // La cola se marca con lo que de verdad salio: si una placa fallo, esa
  // persona sigue esperando su turno y tiene que quedarse en la lista.
  let colaMarcada = null
  const conTurno = created.filter((c) => c.turno != null)
  if (conTurno.length) {
    const placas = {}
    for (const c of conTurno) placas[c.turno] = c.id
    colaMarcada = cola.marcar(conTurno.map((c) => c.turno), placas)
  }

  const notRegistered = created.filter((c) => !c.galleryRegistered)
  const viaApp = created.filter((c) => c.via === 'app').length

  // --- Grabado ---
  //
  // Solo con una pieza: el laser graba lo que haya en el lienzo y la pieza
  // hay que colocarla a mano, asi que un lote no tiene sentido aqui.
  //
  // Y por defecto NO se dispara de golpe: se lanza la VISTA PREVIA, que recorre
  // el contorno sobre la pieza sin quemar, y ahi se para. El disparo llega en
  // una segunda llamada (/api/engrave con confirm) cuando la persona ha visto
  // que el contorno cae donde tiene que caer. Con `preview: false` se salta ese
  // paso y se graba directo, bajo la responsabilidad de quien llama.
  const wantsEngrave = Boolean(spec.engrave)
  const wantsPreview = spec.preview === undefined ? true : Boolean(spec.preview)
  const dryRun = Boolean(spec.dryRun)
  let engrave = null
  if (wantsEngrave) {
    if (!live) {
      engrave = {
        ok: false,
        stage: 'modo',
        error: 'el modo en vivo no esta disponible: Design Space no se abrio con el puerto de depuracion',
        // La landing lo convierte en el boton "Activar modo en vivo".
        fixable: 'live',
      }
    } else if (created.length !== 1) {
      engrave = { ok: false, stage: 'lote', error: `el grabado directo va de uno en uno (llegaron ${created.length} nombres)` }
    } else {
      const target = created[0]
      try {
        if (wantsPreview) {
          // La tarjeta de la galeria se localiza por su titulo.
          const r = await cdp.openAndPreview(target.id, { dryRun, projectName: target.name })
          engrave = r.ok ? { ...r, stage: 'vista-previa', pendienteDeConfirmar: !dryRun } : r
        } else {
          engrave = await cdp.openAndEngrave(target.id, {
            dryRun,
            projectName: target.name,
            stopPreview: true,
            esperado: paresEsperados(target.id),
          })
        }
      } catch (err) {
        engrave = { ok: false, stage: 'cdp', error: err.message }
      }
      console.log(
        `[${new Date().toISOString()}] ${wantsPreview ? 'vista previa' : 'grabado'} "${target.name}" -> ` +
          (engrave?.ok
            ? engrave.dryRun
              ? 'ENSAYO (no se pulso nada)'
              : wantsPreview
                ? 'LANZADA en ' + engrave.deviceName + (engrave.previewing ? ' (en marcha)' : ' (sin panel de trabajo)')
                : engrave.arranco
                  ? 'ARRANCO en ' + engrave.deviceName
                  : 'PULSADO pero sin confirmar (' + engrave.aviso + ')'
            : 'NO (' + engrave?.error + ')')
      )
    }
  }

  // La galeria solo consulta al montarse, asi que hay que remontarla. Si
  // vamos a grabar sobra: abrir el lienzo ya la remonta al volver.
  let refresh = null
  if (viaApp > 0 && !wantsEngrave) {
    try {
      refresh = await cdp.refreshGallery()
    } catch (err) {
      refresh = { refreshed: false, reason: err.message }
    }
  }

  let hint
  if (notRegistered.length) {
    hint = `${notRegistered.length} pieza(s) no entraron en la galeria; abrelas con Archivo > Abrir. Motivo: ${notRegistered[0].galleryError || 'desconocido'}`
  } else if (engrave && !engrave.ok) {
    hint =
      engrave.fixable === 'live'
        ? 'La pieza esta creada y guardada. Para grabarla desde aqui hace falta el modo en vivo: pulsa "Activar modo en vivo" (cierra y reabre Design Space) y vuelve a intentarlo.'
        : `Se genero, pero no se pudo grabar: ${engrave.error}`
  } else if (engrave?.ok && engrave.dryRun) {
    hint = `Ensayo correcto: el proyecto esta abierto y ${engrave.deviceName} responde. No se pulso nada.`
  } else if (engrave?.ok && engrave.stage === 'vista-previa') {
    hint =
      `Vista previa lanzada en ${engrave.deviceName}. Comprueba sobre la pieza que el contorno cae donde quieres` +
      (engrave.aviso ? ` (la app avisa: "${engrave.aviso}")` : '') +
      ' y pulsa "Continuar y grabar".'
  } else if (engrave?.ok && engrave.arranco) {
    hint = `Grabando en ${engrave.deviceName}. No abras la tapa ni muevas la pieza hasta que termine.`
  } else if (engrave?.ok) {
    hint = `Se pulso Grabado laser pero no se pudo confirmar que arrancara: ${engrave.aviso}`
  } else if (viaApp === created.length) {
    hint = refresh?.refreshed
      ? 'Listas y visibles ya en la galeria de Design Space.'
      : `Registradas en la app, pero la galeria no se refresco (${refresh?.reason || 'motivo desconocido'}). Vuelve a la pagina de inicio y apareceran.`
  } else {
    hint = 'Reinicia LaserPecker Design Space para verlas en la galeria (o usa launch-app.ps1 para habilitar el modo en vivo).'
  }

  sendJson(res, failed.length && !created.length ? 400 : 200, {
    ok: created.length > 0,
    createdCount: created.length,
    failedCount: failed.length,
    duplicatesIgnored: duplicates,
    turnosNoEncontrados: faltan,
    colaMarcada,
    template,
    live,
    galleryRefreshed: refresh ? refresh.refreshed : null,
    engrave,
    created,
    failed,
    hint,
  })
}

/**
 * Graba un proyecto que ya existe, por id. Es el paso 2 del flujo.
 *
 * Exige `confirm: true`: este endpoint enciende el laser sobre una pieza real,
 * asi que no se dispara por una llamada distraida. Lo normal es llamarlo
 * despues de la vista previa, cuando la persona ha dado el visto bueno.
 */
async function handleEngrave(req, res) {
  const raw = await readBody(req)
  let spec
  try {
    spec = JSON.parse(raw.toString('utf8'))
  } catch {
    return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
  }

  const id = String(spec.id || '').trim()
  if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) return sendJson(res, 400, { ok: false, error: 'Falta un id de proyecto valido' })

  const dryRun = Boolean(spec.dryRun)
  if (!dryRun && !spec.confirm)
    return sendJson(res, 428, {
      ok: false,
      stage: 'confirmacion',
      error: 'Falta el visto bueno de la vista previa: manda confirm: true para disparar el laser',
    })

  if (!(await cdp.isAvailable()))
    return sendJson(res, 409, {
      ok: false,
      stage: 'modo',
      fixable: 'live',
      error: 'El modo en vivo no esta disponible: Design Space no se abrio con el puerto de depuracion',
    })

  // El nombre es como se localiza la tarjeta en la galeria si el proyecto no
  // esta ya abierto en el lienzo.
  const projectName = spec.name ? String(spec.name) : findProject(id)?.file_name ?? null

  let result
  try {
    // La vista previa suele quedarse en marcha ocupando el panel; se detiene
    // salvo que quien llama diga lo contrario. Y si la pieza la genero este
    // puente, se comprueba que la app vaya a aplicar sus parametros.
    result = await cdp.engraveNow(id, {
      dryRun,
      projectName,
      stopPreview: spec.stopPreview !== false,
      esperado: paresEsperados(id),
    })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message })
  }

  console.log(
    `[${new Date().toISOString()}] grabado id=${id.slice(0, 8)} -> ` +
      (result?.ok
        ? result.dryRun
          ? 'ENSAYO'
          : result.arranco
            ? 'ARRANCO en ' + result.deviceName
            : 'PULSADO sin confirmar (' + result.aviso + ')'
        : 'NO (' + result?.error + ')')
  )

  sendJson(res, result?.ok ? 200 : 409, { ...result, id })
}

/**
 * Abre una pieza ya generada en Design Space y trae la app al frente.
 *
 * Es el "Realizar proyecto" de la landing: sirve para ajustar el diseno a mano
 * sin buscarlo en la galeria. No graba nada.
 */
async function handleOpen(req, res) {
  const raw = await readBody(req)
  let spec
  try {
    spec = JSON.parse(raw.toString('utf8'))
  } catch {
    return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
  }

  const id = String(spec.id || '').trim()
  if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) return sendJson(res, 400, { ok: false, error: 'Falta un id de proyecto valido' })

  if (!(await cdp.isAvailable()))
    return sendJson(res, 409, {
      ok: false,
      fixable: 'live',
      error: 'El modo en vivo no esta disponible: Design Space no se abrio con el puerto de depuracion',
    })

  const projectName = spec.name ? String(spec.name) : findProject(id)?.file_name ?? null
  try {
    const r = await cdp.openProject(id, { projectName })
    console.log(`[${new Date().toISOString()}] abrir id=${id.slice(0, 8)} -> ${r.ok ? r.route : 'NO (' + r.error + ')'}`)
    return sendJson(res, r.ok ? 200 : 409, r)
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message })
  }
}

// --- La galeria -----------------------------------------------------------

/**
 * Que es una placa generada aqui y que es una plantilla que hay que conservar.
 *
 * No hay ninguna marca en la base que lo diga -- la app numera sus proyectos
 * igual que este puente --, asi que se distingue por donde vive el fichero:
 * las placas se escriben en la carpeta de proyectos, y los formatos de los que
 * salen las plantillas se abren desde donde esten (Descargas, normalmente).
 *
 * Y por si alguno acaba copiado a la carpeta de proyectos, tambien se protege
 * lo que se llama como un formato. Ante la duda se conserva: volver a generar
 * una placa cuesta un minuto, y recuperar un formato original puede costar la
 * tarde.
 */
// Las dos rutas se normalizan antes de compararlas: la de la base la escribio
// path.join (barras de Windows) y PROJECT_DIR puede venir de una variable de
// entorno escrita con barras normales. Comparar las cadenas en bruto daba
// "fuera de la carpeta" para placas que estaban justo dentro.
const mismaCarpeta = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

function clasificarProyecto(row) {
  const enCarpeta = Boolean(row.path) && mismaCarpeta(path.dirname(String(row.path)), PROJECT_DIR)
  const nombreDeFormato = /^\s*(formato|plantilla|template|divergency|esfero|placa|logo)\b/i.test(row.file_name || '')
  const mm = (v) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : null)
  return {
    id: row.id,
    nombre: row.file_name,
    // La base guarda el bounding box con todos sus decimales; en una lista para
    // mirar por encima eso es ruido.
    widthMm: mm(row.width),
    heightMm: mm(row.height),
    path: row.path,
    actualizado: row.update_time,
    enCarpeta,
    plantilla: !enCarpeta || nombreDeFormato,
    motivo: !enCarpeta ? 'fuera de la carpeta de proyectos' : nombreDeFormato ? 'se llama como un formato' : null,
  }
}

function galeria() {
  const todos = listProjects().map(clasificarProyecto)
  return {
    proyectos: todos,
    placas: todos.filter((p) => !p.plantilla),
    plantillas: todos.filter((p) => p.plantilla),
  }
}

/**
 * Vacia la galeria de placas generadas.
 *
 * Tres cautelas, porque esto borra trabajo:
 *
 *   1. `confirm: true` obligatorio, como en el grabado.
 *   2. Las plantillas no entran nunca en el "todo": para llevarse una hay que
 *      nombrarla en `ids`, que es lo que hace la landing cuando el usuario la
 *      marca a mano.
 *   3. Es la papelera de la app, no un borrado real. Los .lp2 se quedan en
 *      disco salvo que se pidan borrar aparte.
 */
async function handleDeleteProjects(req, res) {
  const raw = await readBody(req)
  let spec = {}
  if (raw.length) {
    try {
      spec = JSON.parse(raw.toString('utf8'))
    } catch {
      return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
    }
  }

  if (!spec.confirm)
    return sendJson(res, 428, {
      ok: false,
      error: 'Falta confirmar: manda confirm: true para vaciar la galeria',
    })

  const { proyectos, placas, plantillas } = galeria()
  const porId = new Map(proyectos.map((p) => [String(p.id), p]))

  let objetivo
  if (Array.isArray(spec.ids) && spec.ids.length) {
    objetivo = spec.ids.map(String).map((id) => porId.get(id)).filter(Boolean)
  } else if (spec.todo) {
    objetivo = placas
  } else {
    return sendJson(res, 400, { ok: false, error: 'Manda todo: true o una lista de ids' })
  }

  if (!objetivo.length)
    return sendJson(res, 200, {
      ok: true,
      borrados: 0,
      pedidos: 0,
      conservados: plantillas.length,
      plantillas: plantillas.map((p) => p.nombre),
      hint: plantillas.length
        ? `No habia ninguna placa que borrar; las ${plantillas.length} plantillas siguen donde estaban.`
        : 'La galeria ya estaba vacia.',
    })

  const ids = objetivo.map((p) => String(p.id))
  const live = spec.live === undefined ? await cdp.isAvailable() : Boolean(spec.live)

  let resultado
  let via = 'sqlite'
  if (live) {
    try {
      const r = await cdp.deleteViaApp(ids)
      if (r?.ok) resultado = { borrados: r.borrados }
      else resultado = { borrados: r?.borrados || 0, error: r?.error || `${r?.quedan} no se borraron` }
      via = 'app'
    } catch (err) {
      resultado = { borrados: 0, error: err.message }
    }
    // Igual que al registrar: si la app no pudo, se escribe la base a mano.
    if (!resultado.borrados) {
      const r = deleteProjects(ids)
      if (r.borrados) {
        resultado = { borrados: r.borrados, error: resultado.error }
        via = 'sqlite-fallback'
      }
    }
  } else {
    resultado = deleteProjects(ids)
  }

  // Los ficheros solo si se piden, y solo los de la carpeta de proyectos: un
  // .lp2 de Descargas es de su dueno, no de este puente.
  let archivos = null
  if (spec.borrarArchivos) {
    let borrados = 0
    const errores = []
    for (const p of objetivo) {
      if (!p.enCarpeta || !p.path) continue
      try {
        await fsp.unlink(p.path)
        borrados++
      } catch (err) {
        if (err.code !== 'ENOENT') errores.push(`${path.basename(p.path)}: ${err.message}`)
      }
    }
    archivos = { borrados, errores }
  }

  let refresh = null
  if (via === 'app' || via === 'sqlite-fallback') {
    try {
      refresh = await cdp.refreshGallery()
    } catch (err) {
      refresh = { refreshed: false, reason: err.message }
    }
  }

  console.log(
    `[${new Date().toISOString()}] galeria: ${resultado.borrados}/${ids.length} a la papelera via ${via}` +
      `${archivos ? `, ${archivos.borrados} ficheros borrados` : ''}` +
      `${resultado.error ? ` (${resultado.error})` : ''}`
  )

  sendJson(res, resultado.borrados ? 200 : 409, {
    ok: Boolean(resultado.borrados),
    borrados: resultado.borrados,
    pedidos: ids.length,
    conservados: plantillas.length,
    plantillas: plantillas.map((p) => p.nombre),
    via,
    archivos,
    galleryRefreshed: refresh ? refresh.refreshed : null,
    error: resultado.error,
    hint: resultado.borrados
      ? `${resultado.borrados} proyecto(s) a la papelera de Design Space` +
        (plantillas.length ? `; se conservan ${plantillas.length} plantilla(s)` : '') +
        (archivos?.borrados ? `. Ficheros .lp2 borrados: ${archivos.borrados}` : '. Los .lp2 siguen en disco') +
        '. Se pueden recuperar desde la papelera de la app.'
      : `No se borro nada: ${resultado.error || 'la galeria no acepto el borrado'}`,
  })
}

// --- Cola de registro -----------------------------------------------------

/** El puesto de registro por QR: estado, y el codigo ya dibujado si esta abierto. */
function estadoRegistro(url, conQr) {
  const est = registro.estado()
  const destino = url || est.url
  let qrSvg = null
  if (conQr && destino) {
    try {
      qrSvg = qr.toSvg(destino, { escala: 8 })
    } catch (err) {
      qrSvg = null
    }
  }
  return { ...est, qrUrl: destino, qrSvg }
}

async function handleRegistroStart(req, res) {
  const raw = await readBody(req)
  let spec = {}
  if (raw.length) {
    try {
      spec = JSON.parse(raw.toString('utf8'))
    } catch {
      return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
    }
  }

  // Abrir esto es dejar entrar a la red local, asi que se pide a proposito.
  if (!spec.confirm)
    return sendJson(res, 428, {
      ok: false,
      error: 'Falta confirmar: abrir el registro deja el formulario visible para toda la red local',
    })

  const r = await registro.start({ port: spec.port })
  if (!r.ok) return sendJson(res, 409, r)
  // El dibujo del QR se pide aparte (/api/registro/qr.svg): asi la landing lo
  // pinta con un <img> normal y no viajan 7 KB de SVG en cada respuesta.
  return sendJson(res, 200, { ok: true, ...estadoRegistro(spec.url, Boolean(spec.qr)) })
}

async function handleQueue(req, res, method, url) {
  const raw = await readBody(req)
  let spec = {}
  if (raw.length) {
    try {
      spec = JSON.parse(raw.toString('utf8'))
    } catch {
      return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
    }
  }

  if (method === 'DELETE') {
    const r = spec.todo
      ? cola.vaciar({ reiniciarTurnos: Boolean(spec.reiniciarTurnos) })
      : cola.quitar(Array.isArray(spec.turnos) ? spec.turnos : [])
    console.log(`[${new Date().toISOString()}] cola: ${JSON.stringify(r)}`)
    return sendJson(res, 200, { ok: true, ...r, resumen: cola.resumen(), registros: cola.list() })
  }

  return sendJson(res, 200, {
    ok: true,
    resumen: cola.resumen(),
    registros: url?.searchParams.get('todo') === '1' ? cola.list() : cola.pendientes(),
    registro: registro.estado(),
  })
}

/** Plantillas propias: guardar los ajustes probados y volver a usarlos. */
async function handleTemplates(req, res, method) {
  const raw = await readBody(req)
  let spec = {}
  if (raw.length) {
    try {
      spec = JSON.parse(raw.toString('utf8'))
    } catch {
      return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
    }
  }

  try {
    if (method === 'DELETE') {
      const r = deleteTemplate(spec.id)
      console.log(`[${new Date().toISOString()}] plantilla borrada: ${spec.id} (${r.borrada})`)
      return sendJson(res, r.borrada ? 200 : 404, {
        ok: r.borrada,
        error: r.borrada ? undefined : 'No hay ninguna plantilla propia con ese nombre',
        templates: listaPlantillas(),
      })
    }
    const r = saveTemplate(spec)
    console.log(`[${new Date().toISOString()}] plantilla ${r.actualizada ? 'actualizada' : 'guardada'}: ${r.id}`)
    return sendJson(res, 200, { ok: true, ...r, templates: listaPlantillas() })
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message })
  }
}

/** Detiene la vista previa (o el grabado) en curso. */
async function handleStop(req, res) {
  await readBody(req)
  if (!(await cdp.isAvailable()))
    return sendJson(res, 409, { ok: false, error: 'El modo en vivo no esta disponible' })
  try {
    const r = await cdp.stopJob()
    console.log(`[${new Date().toISOString()}] detener -> ${r.ok ? (r.yaParada ? 'no habia nada' : 'parado') : 'NO (' + r.error + ')'}`)
    return sendJson(res, r.ok ? 200 : 409, r)
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message })
  }
}

/**
 * Enlaza la maquina desde la app.
 *
 * Conectar no mueve el laser ni dispara nada, asi que la landing lo puede
 * ofrecer como un boton normal.
 */
async function handleConnect(req, res) {
  await readBody(req)
  if (!(await cdp.isAvailable()))
    return sendJson(res, 409, { ok: false, fixable: 'live', error: 'El modo en vivo no esta disponible' })

  const fisica = await machine.status()

  try {
    const r = await cdp.connectDevice()
    console.log(`[${new Date().toISOString()}] conectar -> ${r.ok ? 'OK ' + r.deviceName : 'NO (' + r.error + ')'}`)
    // Si no se conecto y encima el cacharro no aparece en el equipo, ese es el
    // motivo mas probable y conviene decirlo. No se bloquea el intento por eso:
    // por Bluetooth no hay puerto serie que detectar.
    const error =
      !r.ok && fisica.present === false
        ? `${r.error}. Ademas no se detecta la maquina en el equipo: comprueba que este encendida y con el cable USB puesto.`
        : r.error
    return sendJson(res, r.ok ? 200 : 409, { ...r, error, machine: fisica })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message })
  }
}

/**
 * Activa el modo en vivo: deja Design Space corriendo con el depurador abierto.
 *
 * El puerto de depuracion es un argumento de arranque, asi que si la app se
 * abrio con el icono normal no hay forma de activarlo sin cerrarla y reabrirla.
 * Eso puede tirar trabajo sin guardar, asi que NO se hace por iniciativa del
 * puente: hace falta `confirm: true` en el cuerpo, que es lo que manda la
 * landing cuando el usuario acepta el aviso.
 */
async function handleEnableLive(req, res) {
  const raw = await readBody(req)
  let spec = {}
  if (raw.length) {
    try {
      spec = JSON.parse(raw.toString('utf8'))
    } catch {
      return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
    }
  }

  // Si ya esta activo no se toca la app, ni para comprobarlo.
  if (await cdp.isAvailable()) {
    return sendJson(res, 200, {
      ok: true,
      estado: 'ya-activo',
      mensaje: `Modo en vivo ya activo en el puerto ${cdp.DEFAULT_PORT}.`,
      reiniciada: false,
    })
  }

  if (launcher.isBusy())
    return sendJson(res, 409, { ok: false, estado: 'en-curso', mensaje: 'Ya hay una activacion en marcha; espera a que termine.' })

  const result = await launcher.enableLive({
    port: cdp.DEFAULT_PORT,
    confirm: Boolean(spec.confirm),
    force: Boolean(spec.force),
    shortcut: Boolean(spec.shortcut),
  })

  console.log(`[${new Date().toISOString()}] modo en vivo -> ${result.estado}: ${result.mensaje}`)

  // La app puede tardar un instante mas en montar la ventana; se confirma
  // contra el mismo camino que usara el grabado, no contra lo que diga el
  // script, para no prometer un modo en vivo que el puente no pueda usar.
  const liveAvailable = result.ok ? await cdp.isAvailable() : false

  sendJson(res, result.ok ? 200 : result.estado === 'confirmacion-necesaria' ? 428 : 500, { ...result, liveAvailable })
}

async function handleDesign(req, res) {
  const raw = await readBody(req)
  let spec
  try {
    spec = JSON.parse(raw.toString('utf8'))
  } catch {
    return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON valido' })
  }

  let result
  try {
    result = buildLp2({
      name: safeFileName(spec.name),
      image: decodeImage(spec.image),
      widthMm: numberOrUndefined(spec.widthMm),
      heightMm: numberOrUndefined(spec.heightMm),
      left: numberOrUndefined(spec.left),
      top: numberOrUndefined(spec.top),
      text: spec.text ? String(spec.text) : undefined,
      fontSize: numberOrUndefined(spec.fontSize),
      fontFamily: spec.fontFamily,
      laser: {
        power: numberOrUndefined(spec.power),
        depth: numberOrUndefined(spec.depth),
        dpi: numberOrUndefined(spec.dpi),
        materialName: spec.materialName,
        textPower: numberOrUndefined(spec.textPower),
        textDepth: numberOrUndefined(spec.textDepth),
      },
    })
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message })
  }

  const live = spec.live === undefined ? await cdp.isAvailable() : Boolean(spec.live)
  const saved = await persist(result, safeFileName(spec.name), live)

  sendJson(res, 200, {
    ok: true,
    id: result.fileId,
    path: saved.path,
    widthMm: Number(result.widthMm.toFixed(3)),
    heightMm: Number(result.heightMm.toFixed(3)),
    bytes: result.buffer.length,
    galleryRegistered: saved.galleryRegistered,
    galleryError: saved.galleryError,
    hint: saved.galleryRegistered
      ? 'Reinicia LaserPecker Design Space para verlo en la galeria de proyectos.'
      : 'Abrelo con Archivo > Abrir usando la ruta indicada.',
  })
}

/**
 * La landing. Sale de `public/`, que en el .exe va embebido en el propio
 * ejecutable, asi que se pide por `resources` en vez de leer del disco.
 */
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1))
  // La clave del recurso es una ruta POSIX. Se normaliza antes de mirar si sale
  // de la landing: sin eso, '/a/../../secreto' pasaria el filtro.
  const clean = path.posix.normalize('/' + rel.replace(/\\/g, '/')).slice(1)
  if (!clean || clean.startsWith('..')) {
    res.writeHead(403)
    return res.end('Prohibido')
  }

  const data = resources.read(`public/${clean}`)
  if (!data) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('No encontrado')
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(clean)] || 'application/octet-stream',
    // Sin cache: la landing cambia y no interesa que el navegador sirva
    // una version vieja que hable con un puente ya actualizado.
    'Cache-Control': 'no-store',
  })
  res.end(data)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // Sin cabeceras CORS: cualquier preflight de otro origen muere aqui.
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (!originAllowed(req)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Peticion rechazada: este puente solo atiende a la landing local',
    })
  }

  try {
    if (req.method === 'POST' && url.pathname === '/api/badges') return await handleBadges(req, res)
    if (req.method === 'POST' && url.pathname === '/api/engrave') return await handleEngrave(req, res)
    if (req.method === 'POST' && url.pathname === '/api/live/enable') return await handleEnableLive(req, res)
    if (req.method === 'POST' && url.pathname === '/api/stop') return await handleStop(req, res)
    if (req.method === 'POST' && url.pathname === '/api/open') return await handleOpen(req, res)
    if ((req.method === 'POST' || req.method === 'DELETE') && url.pathname === '/api/templates')
      return await handleTemplates(req, res, req.method)
    if (req.method === 'GET' && url.pathname === '/api/templates')
      return sendJson(res, 200, { ok: true, defaultTemplate: DEFAULT_TEMPLATE, templates: listaPlantillas() })
    if (req.method === 'POST' && url.pathname === '/api/device/connect') return await handleConnect(req, res)
    if (req.method === 'POST' && url.pathname === '/api/design') return await handleDesign(req, res)
    if (req.method === 'DELETE' && url.pathname === '/api/projects') return await handleDeleteProjects(req, res)
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      const g = galeria()
      return sendJson(res, 200, {
        ok: true,
        projectDir: PROJECT_DIR,
        placas: g.placas,
        plantillas: g.plantillas,
        // El nombre de siempre, para no romper a quien ya lo use desde fuera.
        projects: listProjects(),
      })
    }

    // --- registro por QR ---
    if (req.method === 'POST' && url.pathname === '/api/registro/start') return await handleRegistroStart(req, res)
    if (req.method === 'POST' && url.pathname === '/api/registro/stop') {
      await readBody(req)
      const r = await registro.stop()
      return sendJson(res, 200, { ok: true, ...r })
    }
    if (req.method === 'GET' && url.pathname === '/api/registro')
      return sendJson(res, 200, {
        ok: true,
        ...estadoRegistro(url.searchParams.get('url'), url.searchParams.get('qr') === '1'),
      })
    if (req.method === 'GET' && url.pathname === '/api/registro/qr.svg') {
      const destino = url.searchParams.get('url') || registro.estado().url
      if (!destino) return sendJson(res, 409, { ok: false, error: 'El puesto de registro no esta abierto' })
      try {
        const svg = qr.toSvg(destino, { escala: Number(url.searchParams.get('escala')) || 8 })
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(svg)
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message })
      }
    }
    if ((req.method === 'GET' || req.method === 'DELETE') && url.pathname === '/api/queue')
      return await handleQueue(req, res, req.method, url)
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const liveAvailable = await cdp.isAvailable()
      // A nivel de sistema: dice si el cacharro esta enchufado y encendido, que
      // es lo que explica un "no conectado" de la app.
      const fisica = await machine.status()
      let api = null
      let device = null
      if (liveAvailable) {
        // Una sola llamada trae ambas cosas; la landing sondea esto a menudo.
        try {
          api = await cdp.inspectProjectApi()
        } catch (err) {
          api = { present: false, error: err.message }
        }
        try {
          device = await cdp.deviceStatus()
          // Solo se apunta lo leido del DOM: el resto ya son suposiciones.
          if (device && device.connectedFrom === 'dom' && typeof device.connected === 'boolean') {
            ultimaConexion = { connected: device.connected, deviceName: device.deviceName, at: Date.now() }
          }
          if (device && device.connected === null && ultimaConexion) {
            device.lastKnown = { ...ultimaConexion, haceMs: Date.now() - ultimaConexion.at }
          }
        } catch (err) {
          device = { connected: false, error: err.message }
        }
      }
      // Con el modo en vivo caido, la landing necesita saber si puede ofrecer
      // el boton de activarlo y si eso va a cerrar una app abierta.
      const exe = launcher.findExe()
      const app = liveAvailable
        ? { running: true, exeFound: Boolean(exe), exe }
        : { running: await launcher.appRunning(), exeFound: Boolean(exe), exe }

      return sendJson(res, 200, {
        ok: true,
        liveAvailable,
        cdpPort: cdp.DEFAULT_PORT,
        projectApi: api,
        device,
        machine: fisica,
        app,
        canEnableLive: app.exeFound && !launcher.isBusy(),
        // Se puede pedir a la app que enlace la maquina: hay modo en vivo, la
        // app dice que no esta conectada y el cacharro si aparece en el equipo.
        canConnect: Boolean(liveAvailable && device && device.connected !== true && fisica.present !== false),
        projectDir: PROJECT_DIR,
        defaultTemplate: DEFAULT_TEMPLATE,
        templates: listaPlantillas(),
        // Sin el QR: la landing sondea esto cada pocos segundos y el dibujo
        // pesa mas que todo lo demas junto. Se pide aparte al abrir el panel.
        registro: registro.estado(),
      })
    }

    // Medida en vivo para la landing: cuanto ocupara el nombre en mm.
    if (req.method === 'GET' && url.pathname === '/api/measure') {
      try {
        const t = getTemplate(url.searchParams.get('template'))
        const name = String(url.searchParams.get('name') || '').trim().replace(/\s+/g, ' ')
        if (!name) return sendJson(res, 400, { ok: false, error: 'Falta el nombre' })
        const geo = layout(t, name)
        return sendJson(res, 200, {
          ok: true,
          template: t.id,
          textWidthMm: Number(geo.textMmWidth.toFixed(2)),
          widthMm: Number(geo.widthMm.toFixed(2)),
          heightMm: Number(geo.heightMm.toFixed(2)),
          logoWidthMm: Number(geo.logoMmWidth.toFixed(2)),
          exact: Boolean(t.text.widths),
        })
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message })
      }
    }
    if (req.method === 'GET' && url.pathname === '/logo.png') {
      const logo = resources.readOrThrow('assets/divergency-logo-original.png')
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' })
      return res.end(logo)
    }
    if (req.method === 'GET') return serveStatic(req, res, url.pathname)
    sendJson(res, 405, { ok: false, error: 'Metodo no permitido' })
  } catch (err) {
    console.error('error:', err)
    sendJson(res, 500, { ok: false, error: err.message })
  }
})

// --- Arranque -------------------------------------------------------------
//
// El .exe es lo unico que ve quien lo descarga: no hay terminal desde la que se
// haya lanzado, asi que esta ventana tiene que explicarse sola, abrir la landing
// y no desaparecer sin decir por que si algo falla.

const URL_LANDING = `http://127.0.0.1:${PORT}`
const AUTO_OPEN = process.env.LP_OPEN === '0' ? false : resources.packaged || process.env.LP_OPEN === '1'

/** Abre la landing en el navegador por defecto. */
function openBrowser(url) {
  if (process.platform !== 'win32') return
  // `start` es del shell, no un ejecutable. El primer argumento es el titulo de
  // la ventana: sin ese '' vacio, `start` se comeria la URL como titulo.
  try {
    require('node:child_process')
      .spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
      .unref()
  } catch {
    console.log(`Abre ${url} en el navegador.`)
  }
}

/**
 * Sale, pero dejando leer el motivo.
 *
 * Al doble clic en el .exe la ventana se cierra con el proceso, asi que un fallo
 * de arranque seria un parpadeo sin mensaje.
 */
function salir(code) {
  if (!resources.packaged || !process.stdin.isTTY) return process.exit(code)
  console.log('\n  Pulsa Enter para cerrar esta ventana.')
  process.stdin.resume()
  process.stdin.once('data', () => process.exit(code))
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Doble clic dos veces: no es un error, el puente ya estaba levantado.
    console.log(`  El puente ya estaba abierto en el puerto ${PORT}.`)
    if (AUTO_OPEN) {
      console.log('  Se abre la landing y se cierra esta ventana.')
      openBrowser(URL_LANDING)
    } else {
      // Sin abrir nada no se puede decir que se abre: quien lo lanzo desde una
      // terminal necesita la URL, no una promesa que no se cumple.
      console.log(`  Se sigue usando ese: ${URL_LANDING}`)
    }
    return process.exit(0)
  }
  console.error(`  No se pudo abrir el puerto ${PORT}: ${err.message}`)
  salir(1)
})

// Solo loopback: la landing corre en la misma maquina y no hay razon
// para exponer un escritor de ficheros a la red local.
server.listen(PORT, '127.0.0.1', () => {
  if (resources.packaged) {
    console.log('')
    console.log('  Divergency Grabadora Láser')
    console.log('  --------------------')
    console.log('')
    console.log(`  Landing:   ${URL_LANDING}`)
    console.log(`  Proyectos: ${PROJECT_DIR}`)
    console.log(`  Ajustes:   ${resources.dataDir}`)
    console.log('')
    console.log('  Deja esta ventana abierta mientras uses la app.')
    console.log('  Para cerrar el puente: Ctrl+C, o cierra la ventana.')
    console.log('')
  } else {
    console.log(`Puente LaserPecker escuchando en ${URL_LANDING}`)
    console.log(`Proyectos -> ${PROJECT_DIR}`)
  }
  if (!fs.existsSync(PROJECT_DIR)) console.log('  (la carpeta de proyectos se creara al generar la primera pieza)')
  if (AUTO_OPEN) openBrowser(URL_LANDING)
})
