'use strict'

// Cliente minimo del Chrome DevTools Protocol para hablar con el renderer
// de LaserPecker Design Space.
//
// Design Space es una app Electron, asi que su ventana es una pagina de
// Chromium. Si se arranca con --remote-debugging-port=9222 se puede evaluar
// JavaScript dentro de ella, y ahi vive su propia API de galeria:
//
//   window.Project.StorageableAsync({ file_id, path, preview_img, ... })
//   window.Project.FindByIdAsync(id) / FindByOne(...) / DeleteByIdAsync(id)
//
// Llamar a StorageableAsync es mejor que escribir el SQLite a mano: es la
// app la que registra el proyecto, con su misma capa de datos, y la galeria
// se entera sin reiniciar.
//
// No hace falta ninguna dependencia: Node 22+ trae WebSocket global.

const DEFAULT_PORT = Number(process.env.LP_CDP_PORT) || 9222
const TIMEOUT = 10000

/**
 * Sesion CDP: un WebSocket sobre el que mandar varias ordenes.
 *
 * Hace falta porque abrir un proyecto y grabar no se puede hacer solo con
 * Runtime.evaluate: la app ignora los eventos de raton sinteticos. Un
 * elemento.click() sobre una tarjeta de la galeria no hace absolutamente
 * nada (comprobado, 15 s de espera sin reaccion), mientras que un
 * Input.dispatchMouseEvent -- que Chromium entrega como evento de confianza,
 * igual que un raton de verdad -- la abre en 0.7 s.
 */
async function openSession(port = DEFAULT_PORT) {
  const target = await findPageTarget(port)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  let closed = false

  ws.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(`CDP: ${msg.error.message}`)) : p.resolve(msg.result)
  })

  const fail = (err) => {
    closed = true
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }
  ws.addEventListener('error', () => fail(new Error('Fallo la conexion WebSocket con el renderer')))
  ws.addEventListener('close', () => fail(new Error('El renderer cerro la conexion')))

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No se pudo abrir la sesion con el renderer')), 5000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Fallo la conexion WebSocket con el renderer')) })
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('La sesion con el renderer esta cerrada'))
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return {
    send,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r?.exceptionDetails) {
        const text = r.exceptionDetails.exception?.description || r.exceptionDetails.text
        throw new Error(`Excepcion en el renderer: ${text}`)
      }
      return r?.result?.value
    },
    /** Click de verdad, como el de un raton. count=2 para abrir tarjetas. */
    async click(x, y, count = 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
      for (let i = 1; i <= count; i++) {
        const base = { x, y, button: 'left', clickCount: i, buttons: 1 }
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
        if (i < count) await new Promise((r) => setTimeout(r, 60))
      }
    },
    close() {
      closed = true
      try { ws.close() } catch {}
    },
  }
}

/** Localiza la pagina principal de la app entre los targets del depurador. */
async function findPageTarget(port = DEFAULT_PORT) {
  let targets
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })
    targets = await res.json()
  } catch (err) {
    throw new Error(
      `No hay depurador en el puerto ${port}. Arranca Design Space con --remote-debugging-port=${port} (usa launch-app.ps1).`
    )
  }

  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!pages.length) throw new Error('El depurador responde pero no expone ninguna pagina')

  // La ventana principal es la que sirve el frontend desde el puerto 9898.
  return pages.find((p) => /:9898|index\.html/.test(p.url)) || pages[0]
}

/**
 * Evalua una expresion JavaScript dentro del renderer y devuelve su valor.
 * @param {string} expression   Se evalua con await, asi que puede ser una promesa.
 * @param {number} [port]
 * @param {number} [timeoutMs]  Debe cubrir lo que tarde la propia expresion.
 */
async function evaluate(expression, port = DEFAULT_PORT, timeoutMs = TIMEOUT) {
  const target = await findPageTarget(port)
  const ws = new WebSocket(target.webSocketDebuggerUrl)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close() } catch {}
      reject(new Error('Tiempo de espera agotado hablando con el renderer'))
    }, timeoutMs)

    const done = (err, value) => {
      clearTimeout(timer)
      try { ws.close() } catch {}
      err ? reject(err) : resolve(value)
    }

    ws.addEventListener('error', () => done(new Error('Fallo la conexion WebSocket con el renderer')))

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
            // El renderer usa contextos aislados para el preload; el mundo
            // principal es donde vive window.Project.
            includeCommandLineAPI: false,
          },
        })
      )
    })

    ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.id !== 1) return

      if (msg.error) return done(new Error(`CDP: ${msg.error.message}`))
      const r = msg.result
      if (r?.exceptionDetails) {
        const text = r.exceptionDetails.exception?.description || r.exceptionDetails.text
        return done(new Error(`Excepcion en el renderer: ${text}`))
      }
      done(null, r?.result?.value)
    })
  })
}

/** ¿Esta el depurador accesible? */
async function isAvailable(port = DEFAULT_PORT) {
  try {
    await findPageTarget(port)
    return true
  } catch {
    return false
  }
}

/** Comprueba que window.Project exista y liste sus metodos. */
async function inspectProjectApi(port = DEFAULT_PORT) {
  return evaluate(
    `(() => {
       if (typeof window.Project === 'undefined') return { present: false }
       const keys = []
       for (const k in window.Project) keys.push(k + ':' + typeof window.Project[k])
       return { present: true, keys, url: location.href }
     })()`,
    port
  )
}

/**
 * Registra un proyecto en la galeria usando la propia API de la app.
 * @param {{fileId: string, name: string, filePath: string, previewDataUri: string, widthMm: number, heightMm: number}} p
 */
async function registerViaApp(p, port = DEFAULT_PORT) {
  const payload = {
    id: p.fileId,
    file_id: p.fileId,
    path: p.filePath,
    preview_img: p.previewDataUri,
    width: p.widthMm,
    height: p.heightMm,
    file_name: p.name,
    swVersion: 10300,
    hwVersion: 12288,
    version: 2,
    update_time: Date.now(),
  }

  return evaluate(
    `(async () => {
       if (typeof window.Project?.StorageableAsync !== 'function')
         return { ok: false, error: 'window.Project.StorageableAsync no esta disponible' }
       try {
         const result = await window.Project.StorageableAsync(${JSON.stringify(payload)})
         return { ok: true, result: result === undefined ? null : result }
       } catch (e) {
         return { ok: false, error: String(e && e.message || e) }
       }
     })()`,
    port
  )
}

/**
 * Manda proyectos a la papelera usando la propia API de la app.
 *
 * Mismo motivo que para registrar: mejor que la app borre con su capa de datos
 * a escribir el SQLite por detras mientras ella lo tiene abierto. Y es borrado
 * blando -- rellena `deleted_date` y deja la fila, asi que se puede restaurar.
 *
 * SE BORRA DE UNO EN UNO aunque exista `DeleteByIdListAsync`, porque el de
 * lote esta roto en la app (2.12.1) y falla SIEMPRE:
 *
 *   LimitOnUpdateNotSupportedError: Your database does not support LIMIT on
 *   UPDATE statements.
 *
 * Es su ORM metiendo un LIMIT en el UPDATE del borrado blando, que SQLite no
 * acepta. `DeleteByIdAsync` no pasa por ahi y responde { affected: 1 }.
 *
 * @param {string[]} ids
 */
async function deleteViaApp(ids, port = DEFAULT_PORT) {
  const lista = [...new Set((ids || []).map(String))].filter((id) => /^[0-9a-fA-F-]{8,64}$/.test(id))
  if (!lista.length) return { ok: true, borrados: 0 }

  return evaluate(
    `(async () => {
       const ids = ${JSON.stringify(lista)}
       const P = window.Project
       if (!P) return { ok: false, error: 'window.Project no esta disponible' }
       if (typeof P.DeleteByIdAsync !== 'function')
         return { ok: false, error: 'la app no expone DeleteByIdAsync' }

       const fallos = []
       for (const id of ids) {
         try { await P.DeleteByIdAsync(id) }
         catch (e) { fallos.push(String(e && e.message || e)) }
       }

       // Se comprueba contra la propia app en vez de dar por bueno el silencio:
       // lo que cuenta es que ya no esten, no que la llamada no fallara. Tras
       // borrar, FindByIdAsync devuelve null.
       let quedan = 0
       if (typeof P.FindByIdAsync === 'function') {
         for (const id of ids) {
           try {
             const row = await P.FindByIdAsync(id)
             if (row && !row.deleted_date) quedan++
           } catch (e) {}
         }
       }
       return {
         ok: quedan === 0,
         borrados: ids.length - quedan,
         quedan,
         error: quedan ? (fallos[0] || quedan + ' siguen en la galeria') : undefined,
       }
     })()`,
    port,
    // Un lote grande son muchas llamadas seguidas dentro de la app.
    Math.max(20000, lista.length * 400)
  )
}

/**
 * Fuerza a la galeria a releer la lista de proyectos.
 *
 * La vista solo consulta la base al montarse, asi que registrar un proyecto
 * no la actualiza sola. Un rebote de ruta la remonta y vuelve a consultar.
 *
 * SALVAGUARDA: solo se rebota si el usuario esta en la galeria. Hacerlo
 * mientras edita un diseno desmontaria el lienzo y perderia su trabajo sin
 * guardar, asi que en ese caso no se toca nada.
 */
async function refreshGallery(port = DEFAULT_PORT) {
  return evaluate(
    `(async () => {
       const from = location.hash
       if (!/^#\\/dashboard/.test(from))
         return { refreshed: false, reason: 'el usuario no esta en la galeria', route: from }
       location.hash = '#/setting'
       await new Promise(r => setTimeout(r, 600))
       location.hash = from
       await new Promise(r => setTimeout(r, 900))
       return { refreshed: true, route: location.hash }
     })()`,
    port
  )
}

// --- Control del grabado --------------------------------------------------
//
// Design Space no expone ninguna orden de grabado a la que llamar: el laser
// se dispara desde su propio boton. Pulsarlo por DOM es preferible a hablarle
// al dispositivo por IPC, porque el disparo pasa por el flujo normal de la
// app y conserva todas sus comprobaciones.

/** Selector del boton primario del panel de grabado ("Grabado laser"). */
const ENGRAVE_BTN = 'button.setting_button_item.lp-button_primary'

/**
 * Trozo de JS reutilizable: localiza dispositivo, botones y trabajo en curso.
 *
 * Define funciones en vez de constantes sueltas: asi quien lo inserta puede
 * llamarlas las veces que quiera sin chocar con sus propias variables.
 *
 * CUIDADO con como se elige el boton. Mientras hay un trabajo en marcha la
 * app monta OTRO panel, con "pausa" y "detener", que usa exactamente las
 * mismas clases que el de reposo y se solapa con el casi pixel a pixel:
 *
 *   reposo    Vista previa | Grabado laser    y=614  h=48
 *   en marcha        pausa | detener          y=628  h=34
 *
 * Con lo cual .lp-button_primary casa con "Grabado laser" o con "detener"
 * segun el momento, y un click a ciegas pararia el trabajo en vez de
 * lanzarlo. Por eso primero se mira si hay trabajo en curso y solo entonces
 * se resuelven los botones.
 *
 * Y OJO: la app NO deshabilita "Grabado laser" cuando no hay maquina
 * conectada (comprobado: disabled=false con el aviso "Dispositivo no
 * conectado" en pantalla). Fiarse de `disabled` no basta; la conexion hay que
 * comprobarla aparte.
 */
const INSPECT_UI = `
  const _txt = (el) => ((el && el.innerText) || '').replace(/\\s+/g, ' ').trim()
  // La app guarda la cadena "undefined" en el store, no undefined.
  const _vacio = (v) => v === undefined || v === null || v === '' || v === 'undefined' || v === 'null'

  /**
   * Sitio donde pulsar un boton: centro, si esta fuera de la ventana y si algo
   * lo tapa. Nunca se pulsa a ciegas -- si un modal se cruza, o si el panel esta
   * desplazado, el click se iria a otra parte o a ningun sitio.
   */
  const _sitio = (b) => {
    if (!b) return null
    const r = b.getBoundingClientRect()
    if (!r.width || !r.height) return null
    const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    const fuera = r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth
    const encima = fuera ? null : document.elementFromPoint(c.x, c.y)
    const libre = !!(encima && (encima === b || b.contains(encima)))
    return {
      centro: c,
      texto: _txt(b),
      disabled: !!b.disabled,
      // La columna de ajustes crece y deja los botones por debajo del borde: en
      // una ventana de 672 de alto se han visto en y=891. Hay que bajarlos.
      fuera,
      despejado: libre,
      tapadoPor: (fuera || libre) ? null : (_txt(encima).slice(0, 30) || (encima && encima.tagName) || null),
    }
  }

  const _store = () => {
    try {
      return document.querySelector('#app').__vue_app__
        .config.globalProperties['$pinia'].state.value.useDeviceStore || null
    } catch (e) { return null }
  }

  /**
   * Resuelve el panel de accion que esta montado.
   *
   * La app APILA paneles en la misma columna en vez de quitarlos: al entrar en
   * vista previa monta el suyo y empuja el de reposo fuera de la ventana (y=910
   * con 672 de alto), y al volver deja bloques que dejan los botones de reposo
   * tambien fuera (y=891). Asi que ni la posicion ni el hit-test sirven para
   * saber que panel manda: se resuelve por lo que cada panel ES, y despues se
   * baja el boton a la vista antes de pulsarlo.
   *
   * Depende del idioma de la app para distinguir la vista previa (aqui es
   * es-ES); si se cambiara el idioma habria que ampliar esas expresiones.
   */
  const _panel = () => {
    const all = [...document.querySelectorAll('button.setting_button_item')]

    // Trabajo en curso: la app monta "pausa"/"detener" con las mismas clases que
    // el panel de reposo, asi que un click a ciegas por clase pararia el trabajo
    // en vez de lanzarlo.
    const parar = all.find(b => /^(detener|pausa|stop|pause)$/i.test(_txt(b))) || null
    if (parar) return { modo: 'trabajando', parar, pri: null, sec: null, total: all.length }

    // Vista previa: su boton de salida es inconfundible.
    const salir = all.find(b => /salir|exit/i.test(_txt(b)) && /previa|preview/i.test(_txt(b))) || null
    if (salir) {
      const hermanos = [...(salir.parentElement || document).querySelectorAll('button.setting_button_item')]
      return {
        modo: 'vista-previa',
        parar: null,
        sec: salir,
        pri: hermanos.find(b => b.classList.contains('lp-button_primary')) || null,
        total: all.length,
      }
    }

    // Reposo. Si quedaran restos de otro panel se cogen los ultimos del DOM, que
    // son los del panel montado mas recientemente.
    const pris = all.filter(b => b.classList.contains('lp-button_primary'))
    const secs = all.filter(b => b.classList.contains('lp-button_default'))
    return {
      modo: 'reposo',
      parar: null,
      pri: pris.length ? pris[pris.length - 1] : null,
      sec: secs.length ? secs[secs.length - 1] : null,
      total: all.length,
    }
  }

  /** El ultimo dialogo visible, si hay alguno. Ant deja los cerrados en el DOM. */
  const _modalVisible = () => {
    const vivos = [...document.querySelectorAll('.ant-modal-wrap')]
      .filter(w => getComputedStyle(w).display !== 'none')
    return vivos.length ? vivos[vivos.length - 1] : null
  }

  const _btnDialogo = (cual) => {
    const w = _modalVisible()
    if (!w) return null
    const btns = [...w.querySelectorAll('.ant-modal-footer button')]
    if (!btns.length) return null
    return cual === 'confirmar'
      ? (btns.find(b => b.classList.contains('ant-btn-primary')) || null)
      : (btns.find(b => !b.classList.contains('ant-btn-primary')) || null)
  }

  /**
   * El aviso de verificacion que la app abre al pulsar "Grabado laser".
   *
   * No es un estorbo: es una reja. Hasta que no se acepta, la maquina no hace
   * nada, y ademas dice EXACTAMENTE con que parametros va a grabar, lo que
   * permite comprobar que coincidan con los de la pieza que se genero.
   */
  const leerDialogo = () => {
    const w = _modalVisible()
    if (!w) return null
    const modal = w.querySelector('.ant-modal') || w
    const cuerpo = _txt(modal.querySelector('.ant-modal-body')) || _txt(modal)
    const pares = []
    const re = /(?:Potencia|Power|功率)\\s*:?\\s*(\\d+)\\s*(?:profundidad|depth|深度)\\s*:?\\s*(\\d+)/gi
    let m
    while ((m = re.exec(cuerpo)) !== null) pares.push({ potencia: Number(m[1]), profundidad: Number(m[2]) })
    return {
      deImpresion: /print-info-modal/.test(String(modal.className)),
      titulo: _txt(modal.querySelector('.ant-modal-title')),
      cuerpo: cuerpo.slice(0, 400),
      pares,
      confirmar: _sitio(_btnDialogo('confirmar')),
      cancelar: _sitio(_btnDialogo('cancelar')),
    }
  }

  /** El boton rojo "Conecta el dispositivo" (no "Desconectar", que tambien es rojo). */
  const _botonConectar = () =>
    [...document.querySelectorAll('button')].find(b =>
      /lp-button_danger/.test(String(b.className)) &&
      /conect/i.test(_txt(b)) && !/desconect/i.test(_txt(b))) || null

  const _elegir = (p, cual) =>
      cual === 'grabar' ? (p.modo === 'reposo' ? p.pri : null)
    : cual === 'vista' ? (p.modo === 'reposo' ? p.sec : null)
    : cual === 'salirPrevia' ? (p.modo === 'vista-previa' ? p.sec : null)
    : cual === 'siguientePrevia' ? (p.modo === 'vista-previa' ? p.pri : null)
    : cual === 'parar' ? p.parar
    : cual === 'conectar' ? _botonConectar()
    : cual === 'dialogoConfirmar' ? _btnDialogo('confirmar')
    : cual === 'dialogoCancelar' ? _btnDialogo('cancelar')
    : null

  /**
   * Baja el boton pedido a la vista y devuelve su sitio ya remedido.
   *
   * Sin esto, en una ventana pequena se manda el click a unas coordenadas que
   * estan fuera de la pantalla y no pasa nada: el peor fallo posible, porque
   * desde fuera parece que si se ha pulsado.
   */
  const traerAVista = async (cual) => {
    const p = _panel()
    const b = _elegir(p, cual)
    if (!b) return { encontrado: false, modo: p.modo, botones: p.total }
    const r = b.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight) {
      try { b.scrollIntoView({ block: 'center', inline: 'nearest' }) }
      catch (e) { try { b.scrollIntoView() } catch (e2) {} }
      await new Promise(res => requestAnimationFrame(() => setTimeout(res, 180)))
    }
    return { encontrado: true, modo: p.modo, botones: p.total, sitio: _sitio(b) }
  }

  const readUi = () => {
    const p = _panel()
    const prog = document.querySelector('.ant-progress-text')
    const enMarcha = p.parar
      ? { boton: _txt(p.parar), progreso: prog ? _txt(prog) : null, sitio: _sitio(p.parar) }
      : null
    const modo = p.modo
    const conectar = _botonConectar()

    const st = _store()
    const delStore = st
      ? (!_vacio(st.currentDeviceName) ? String(st.currentDeviceName)
        : (!_vacio(st.currentDevice) ? String(st.currentDevice) : null))
      : null
    const delDom = [...document.querySelectorAll('button')].map(_txt).find(t => /^LP[0-9A-Z]/i.test(t) && t.length < 40)
      || [...document.querySelectorAll('div,span,p')]
        .filter(el => el.childElementCount === 0)
        .map(_txt)
        .find(t => /^LP[0-9A-Z]/i.test(t) && t.length < 40)
      || null

    return {
      onCanvas: /^#\\/canvas\\//.test(location.hash),
      route: location.hash,
      modo,
      botones: p.total,
      enMarcha,
      // Cada boton solo se ofrece en el modo al que pertenece. "Siguiente" se
      // expone por completitud, pero para grabar se sale de la previa y se pulsa
      // "Grabado laser": es el camino comprobado.
      grabar: _sitio(_elegir(p, 'grabar')),
      vista: _sitio(_elegir(p, 'vista')),
      salirPrevia: _sitio(_elegir(p, 'salirPrevia')),
      siguientePrevia: _sitio(_elegir(p, 'siguientePrevia')),
      conectar: _sitio(conectar),
      pideConectar: !!conectar,
      deviceName: delDom || delStore,
      deviceEnDom: delDom,
      deviceEnStore: delStore,
      conocidos: st && st.devicesConfig ? Object.keys(st.devicesConfig) : [],
    }
  }

  /**
   * ¿Hay maquina conectada?
   *
   *   true  -> la app tiene una maquina enlazada
   *   false -> la app pide conectarla (boton rojo presente)
   *   null  -> no se puede saber desde esta pantalla
   *
   * Fuera del lienzo la app no pinta nada de esto, pero el store sobrevive al
   * desmontaje: si alguna vez se abrio un diseno, ahi queda lo ultimo que
   * sabia. Se devuelve marcando la fuente para no presentar un recuerdo como
   * si fuera una lectura del momento.
   */
  const readConexion = (ui) => {
    if (ui.pideConectar) return { connected: false, fuente: 'dom' }
    if (ui.onCanvas) return { connected: !!ui.deviceName, fuente: 'dom' }
    if (ui.deviceEnStore) return { connected: true, fuente: 'store' }
    return { connected: null, fuente: 'ninguna' }
  }
`

/** Lectura completa del panel: botones, conexion y trabajo en curso. */
const LEER_UI = `(() => {
  ${INSPECT_UI}
  const ui = readUi()
  ui.conexion = readConexion(ui)
  // Solo los dialogos VIVOS: Ant deja los cerrados en el DOM, y darlos por
  // abiertos hacia creer que la app estaba pidiendo algo cuando no.
  const dlg = leerDialogo()
  ui.dialogoInfo = dlg
  ui.dialogo = dlg ? dlg.cuerpo.slice(0, 200) : null
  return ui
})()`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const leerUi = (s) => s.evaluate(LEER_UI)

/**
 * Estado de la maquina.
 *
 * `connected` es tri-estado a proposito:
 *   true  -> la app tiene maquina enlazada
 *   false -> la app esta pidiendo conectarla (boton rojo en pantalla)
 *   null  -> desde esta pantalla no se puede saber
 *
 * `connectedFrom` dice de donde sale el dato ('dom' = lectura del momento,
 * 'store' = lo ultimo que sabia la app), para no vender un recuerdo como si
 * fuera una comprobacion en vivo.
 */
async function deviceStatus(port = DEFAULT_PORT) {
  const ui = await evaluate(LEER_UI, port)
  return {
    onCanvas: ui.onCanvas,
    route: ui.route,
    // 'reposo' | 'vista-previa' | 'trabajando'
    modo: ui.modo,
    deviceName: ui.deviceName,
    knownDevices: ui.conocidos,
    connected: ui.conexion.connected,
    connectedFrom: ui.conexion.fuente,
    // La app pide conectar: es el aviso mas claro y solo sale en el lienzo.
    needsConnect: ui.pideConectar,
    enMarcha: ui.enMarcha,
    engraveButton: ui.grabar
      ? { present: true, disabled: ui.grabar.disabled, text: ui.grabar.texto }
      : { present: false },
    previewButton: ui.vista
      ? { present: true, disabled: ui.vista.disabled, text: ui.vista.texto }
      : { present: false },
  }
}

/**
 * Deja el proyecto `id` montado en el lienzo, abriendolo por su tarjeta de la
 * galeria si hace falta.
 *
 * Se abre por la tarjeta y no por la ruta porque cambiar location.hash a
 * #/canvas/<id> mueve el router pero deja el editor VACIO: la app monta la
 * vista desde useFileStore.openFile, y ese store solo lo rellena su propio
 * flujo de apertura.
 */
async function ensureOpen(s, id, projectName, deadline) {
  const route = () => s.evaluate('location.hash')
  // La ruta puede traer cola de query (`#/dashboard?backId=...` se ha visto),
  // asi que se compara el prefijo y no la cadena entera: con igualdad estricta
  // un `?algo` haria creer que el lienzo nunca monto.
  const enEsteLienzo = `/^#\\/canvas\\/${id.replace(/[^0-9a-fA-F-]/g, '')}(\\?|$)/.test(location.hash)`
  const mounted = async () =>
    (await s.evaluate(`${enEsteLienzo} && !!document.querySelector(${JSON.stringify(ENGRAVE_BTN)})`)) === true

  if (await mounted()) return { ok: true, reabierto: false }

  // Un aviso de verificacion abierto de un intento anterior pone una mascara
  // sobre TODA la ventana: los clicks en la galeria irian a la mascara y el
  // proyecto no se abriria nunca, con un "no monto a tiempo" que no explica
  // nada. Asi que se cierra antes de tocar la galeria.
  const previo = await leerUi(s)
  if (previo.dialogoInfo && previo.dialogoInfo.deImpresion) {
    await pulsar(s, 'dialogoCancelar', 'cancelar del aviso anterior')
    await wait(400)
  }

  if (!projectName)
    return {
      ok: false,
      stage: 'abrir',
      error: 'el proyecto no esta abierto en el lienzo y no llego su nombre para buscarlo en la galeria',
      route: await route(),
    }

  // A la galeria. Solo consulta al montarse, asi que si ya estamos en ella
  // hay que remontarla para que aparezca lo recien creado.
  await s.evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    if (/^#\\/dashboard/.test(location.hash)) { location.hash = '#/cloud'; await wait(500) }
    location.hash = '#/dashboard'
  })()`)

  // Al remontar la galeria las tarjetas entran con animacion y se recolocan.
  // Medir y pulsar en el mismo instante manda el click a donde la tarjeta
  // ESTABA: unas veces no pasa nada y otras se abre la de al lado. Asi que se
  // deja asentar y se exige la MISMA posicion en dos medidas seguidas.
  //
  // Y con el punto de click comprobado: si algo la tapa, el doble click no
  // abriria nada y el fallo saldria como "no monto a tiempo", que manda a
  // buscar el problema al sitio equivocado.
  await wait(700)
  let tarjeta = null
  let estable = null
  let previa = null
  const medir = () =>
    s.evaluate(`(() => {
      const c = [...document.querySelectorAll('.recently_item')]
        .find(e => (e.querySelector('.recently_item_text--title')?.innerText || '').trim() === ${JSON.stringify(projectName)})
      if (!c) return null
      const r = c.getBoundingClientRect()
      if (!r.width || !r.height) return null
      const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      const fuera = r.top < 0 || r.bottom > innerHeight
      if (fuera) { try { c.scrollIntoView({ block: 'center' }) } catch (e) {} }
      const r2 = c.getBoundingClientRect()
      const centro = { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 }
      const encima = document.elementFromPoint(centro.x, centro.y)
      const libre = !!(encima && (encima === c || c.contains(encima)))
      return {
        centro,
        libre,
        tapadoPor: libre ? null : ((encima && (String(encima.className) || encima.tagName)) || 'algo').slice(0, 60),
      }
    })()`)

  while (Date.now() < deadline) {
    const m = await medir()
    if (m) tarjeta = m
    const quieta =
      m && previa && Math.abs(m.centro.x - previa.centro.x) < 2 && Math.abs(m.centro.y - previa.centro.y) < 2
    if (m && m.libre && quieta) {
      estable = m
      break
    }
    previa = m
    await wait(250)
  }

  if (!tarjeta)
    return {
      ok: false,
      stage: 'abrir',
      route: await route(),
      error: `no aparecio en la galeria ninguna tarjeta llamada "${projectName}"`,
    }
  if (!tarjeta.libre)
    return {
      ok: false,
      stage: 'abrir',
      route: await route(),
      error: `la tarjeta "${projectName}" esta tapada por ${tarjeta.tapadoPor}; cierra el aviso que tenga abierto Design Space`,
    }

  // Si nunca se quedo quieta se pulsa en la ultima posicion vista: el doble
  // click puede fallar, pero para eso esta la comprobacion de que monte EL id.
  const center = (estable || tarjeta).centro

  // Doble click, y de confianza: la app ignora los eventos sinteticos.
  await s.click(center.x, center.y, 2)

  // Se le dan 8 s de propina aunque el plazo general se haya agotado buscando la
  // tarjeta: si no, el click sale y nadie espera la respuesta, que es un fallo
  // absurdo ("no monto a tiempo") cuando en realidad no se espero nada.
  const plazoMontaje = Math.max(deadline, Date.now() + 8000)
  while (Date.now() < plazoMontaje) {
    if (await mounted()) return { ok: true, reabierto: true }
    await wait(200)
  }

  const r = await route()
  const m = /^#\/canvas\/([^?]+)/.exec(r)
  return {
    ok: false,
    stage: 'abrir',
    route: r,
    error:
      m && m[1] !== id
        ? `se abrio otro proyecto (${m[1].slice(0, 8)}), no el que toca; hay varios con ese nombre`
        : 'el lienzo no monto el proyecto a tiempo',
  }
}

/**
 * Compara los parametros que la app va a aplicar con los de la pieza generada.
 *
 * @param {Array<{potencia:number,profundidad:number}>} pares  Lo que dice el aviso.
 * @param {Array<{potencia:number,profundidad:number}>} [esperado]
 * @returns {string|null} Frase del desajuste, o null si cuadra (o no hay con que comparar).
 */
function desajustaParametros(pares, esperado) {
  if (!esperado || !esperado.length || !pares || !pares.length) return null
  const visto = pares.map((p) => `${p.potencia}/${p.profundidad}`)
  // Sin orden: el aviso lista relleno e imagen en el orden que quiere la app.
  const faltan = esperado
    .map((e) => `${e.potencia}/${e.profundidad}`)
    .filter((clave) => !visto.includes(clave))
  if (!faltan.length) return null
  return `la app va a grabar con ${visto.join(' y ')} (potencia/profundidad), pero la pieza se genero con ${esperado
    .map((e) => `${e.potencia}/${e.profundidad}`)
    .join(' y ')}`
}

/** Motivo, en una frase, de por que no se puede disparar. Null si se puede. */
function pegaConexion(ui) {
  if (ui.conexion.connected === false)
    return 'Design Space no tiene la maquina conectada: pulsa "Conecta el dispositivo" en la app (o el boton Conectar de la landing)'
  if (!ui.deviceName) return 'no se pudo identificar ninguna maquina conectada en Design Space'
  return null
}

/**
 * Pulsa un boton del panel, bajandolo antes a la vista.
 *
 * Todo click pasa por aqui: es el unico sitio donde se comprueba que el boton
 * exista en el panel activo, que se vea, que no este tapado y que no este
 * deshabilitado. Si algo de eso falla, no se pulsa nada.
 */
async function pulsar(s, cual, etiqueta) {
  const mirar = () =>
    s.evaluate(`(async () => {
      ${INSPECT_UI}
      return await traerAVista(${JSON.stringify(cual)})
    })()`)

  // Se insiste un par de segundos antes de rendirse: al cambiar de panel la app
  // deja un DIV contenedor por encima del boton unas decimas mientras monta la
  // vista (visto justo al salir del modo vista previa). Rendirse en el primer
  // intento convertiria una animacion en un fallo.
  let prep = await mirar()
  const hasta = Date.now() + 2500
  while (Date.now() < hasta && prep && prep.encontrado && prep.sitio && !prep.sitio.despejado && !prep.sitio.fuera) {
    await wait(300)
    prep = await mirar()
  }

  if (!prep || !prep.encontrado)
    return { ok: false, error: `el boton de ${etiqueta} no esta en el panel activo (modo ${prep ? prep.modo : 'desconocido'})` }
  const sitio = prep.sitio
  if (!sitio) return { ok: false, error: `el boton de ${etiqueta} no tiene tamano en pantalla` }
  if (sitio.disabled) return { ok: false, error: `el boton de ${etiqueta} esta deshabilitado` }
  if (sitio.fuera)
    return {
      ok: false,
      error: `el boton de ${etiqueta} sigue fuera de la ventana despues de bajar el panel; agranda la ventana de Design Space`,
    }
  if (!sitio.despejado)
    return {
      ok: false,
      error: `hay algo tapando el boton de ${etiqueta}${sitio.tapadoPor ? ' ("' + sitio.tapadoPor + '")' : ''}; no se pulsa a ciegas`,
    }

  await s.click(sitio.centro.x, sitio.centro.y, 1)
  return { ok: true, sitio, modo: prep.modo }
}

/** Sale del modo vista previa y espera a que vuelva el panel de reposo. */
async function salirVistaPrevia(s) {
  const p = await pulsar(s, 'salirPrevia', 'salir de la vista previa')
  if (!p.ok) return p

  const hasta = Date.now() + 8000
  let actual = null
  while (Date.now() < hasta) {
    await wait(400)
    actual = await leerUi(s)
    if (actual.modo === 'reposo') return { ok: true, ui: actual }
  }
  return { ok: false, error: 'la app no salio del modo vista previa', ui: actual }
}

/** Detiene el trabajo en curso y espera a que vuelva el panel de reposo. */
async function pararTrabajo(s) {
  const p = await pulsar(s, 'parar', 'detener')
  if (!p.ok) return p

  const hasta = Date.now() + 8000
  let actual = null
  while (Date.now() < hasta) {
    await wait(400)
    actual = await leerUi(s)
    if (!actual.enMarcha) return { ok: true, ui: actual }
  }
  return { ok: false, error: 'la app no volvio al panel de reposo despues de detener', ui: actual }
}

/**
 * Pulsa "Grabado laser" sobre el proyecto que YA esta montado en el lienzo.
 *
 * Todas las comprobaciones son previas al click y ninguna se puede saltar: el
 * boton graba lo que haya en el lienzo, asi que si algo no cuadra no se
 * dispara. Ante la duda, no se dispara.
 */
async function dispararGrabado(s, id, opts = {}) {
  let ui = await leerUi(s)

  // Un aviso de verificacion de un intento anterior taparia todo el panel. Si es
  // el de impresion (y no, por ejemplo, un "hay cambios sin guardar"), se cierra
  // y se sigue: dejarlo ahi bloquearia el grabado sin explicar por que.
  if (!ui.enMarcha && ui.dialogoInfo && ui.dialogoInfo.deImpresion) {
    await pulsar(s, 'dialogoCancelar', 'cancelar del aviso anterior')
    await wait(400)
    ui = await leerUi(s)
  }

  // Modo vista previa: hay que salir antes, porque el "Grabado laser" del panel
  // de reposo esta fuera de pantalla y el click se perderia.
  if (ui.modo === 'vista-previa') {
    if (!opts.pararPrevia)
      return {
        ok: false,
        stage: 'vista-previa',
        route: ui.route,
        deviceName: ui.deviceName,
        error: 'la app esta en modo vista previa; sal de la vista previa antes de grabar',
      }
    const salida = await salirVistaPrevia(s)
    if (!salida.ok) return { ok: false, stage: 'vista-previa', route: ui.route, deviceName: ui.deviceName, error: salida.error }
    // Que el panel de reposo acabe de montarse antes de tocarlo.
    await wait(900)
    ui = await leerUi(s)
  }

  // Un trabajo de verdad en marcha ocupa el panel; hay que pararlo primero.
  if (ui.enMarcha) {
    if (!opts.pararPrevia)
      return {
        ok: false,
        stage: 'ocupada',
        route: ui.route,
        deviceName: ui.deviceName,
        enMarcha: ui.enMarcha,
        error: `la maquina esta ocupada${ui.enMarcha.progreso ? ' (' + ui.enMarcha.progreso + ')' : ''}; espera a que termine`,
      }
    const parada = await pararTrabajo(s)
    if (!parada.ok) return { ok: false, stage: 'parar', route: ui.route, deviceName: ui.deviceName, error: parada.error }
    await wait(400)
    ui = await leerUi(s)
  }

  const pega = pegaConexion(ui)
  if (pega) return { ok: false, stage: 'dispositivo', error: pega, route: ui.route, needsConnect: ui.pideConectar }

  // Que el lienzo siga siendo el del proyecto que toca. Si el usuario ha
  // navegado entre la vista previa y el "continuar", grabar aqui seria grabar
  // otro diseno sobre la pieza.
  if (!new RegExp(`^#/canvas/${id.replace(/[^0-9a-fA-F-]/g, '')}(\\?|$)`).test(ui.route))
    return {
      ok: false,
      stage: 'lienzo',
      route: ui.route,
      error: 'el lienzo ya no muestra ese proyecto; vuelve a generarlo antes de grabar',
    }

  if (!ui.grabar)
    return {
      ok: false,
      stage: 'boton',
      deviceName: ui.deviceName,
      route: ui.route,
      error: `el boton de grabado no esta en el panel activo (modo ${ui.modo})`,
    }

  const info = { id, deviceName: ui.deviceName, route: ui.route, buttonText: ui.grabar.texto }
  if (opts.dryRun) return { ok: true, dryRun: true, engraved: false, ...info }

  const p = await pulsar(s, 'grabar', 'grabado')
  if (!p.ok) return { ok: false, stage: 'boton', deviceName: ui.deviceName, route: ui.route, error: p.error }

  // La app no arranca al pulsar: abre su aviso de verificacion con el
  // dispositivo, el modo y los parametros. Hay que esperarlo, comprobarlo y
  // aceptarlo.
  let after = null
  const hasta = Date.now() + 6000
  while (Date.now() < hasta) {
    await wait(400)
    after = await leerUi(s)
    if (after.enMarcha || after.dialogoInfo) break
  }

  let verificacion = null
  if (!after?.enMarcha && after?.dialogoInfo) {
    const dlg = after.dialogoInfo
    verificacion = { titulo: dlg.titulo, resumen: dlg.cuerpo, pares: dlg.pares }

    // Que la maquina vaya a aplicar los parametros de LA PIEZA que se genero.
    // Si no cuadran, se cancela: grabar con otra potencia estropea la pieza y
    // aqui es trivial de detectar, porque la propia app los esta enseñando.
    const desajuste = desajustaParametros(dlg.pares, opts.esperado)
    if (desajuste) {
      const c = await pulsar(s, 'dialogoCancelar', 'cancelar del aviso')
      return {
        ok: false,
        stage: 'parametros',
        ...info,
        error: `${desajuste}. Se ha cancelado el aviso sin grabar${c.ok ? '' : ' (y no se pudo cerrar: ciérralo en la app)'}`,
        verificacion,
      }
    }

    if (!dlg.confirmar)
      return { ok: false, stage: 'dialogo', ...info, error: `la app abrio un aviso sin boton de confirmar: "${dlg.cuerpo}"`, verificacion }

    const c = await pulsar(s, 'dialogoConfirmar', 'confirmar del aviso')
    if (!c.ok) return { ok: false, stage: 'dialogo', ...info, error: c.error, verificacion }

    // Y ahora si: a esperar el panel de trabajo.
    const hasta2 = Date.now() + 8000
    while (Date.now() < hasta2) {
      await wait(400)
      after = await leerUi(s)
      if (after.enMarcha) break
    }
  }

  // Confirmar que arranco de verdad. Un click que no hiciera nada seria el
  // peor fallo posible: la landing diria "grabando" y no estaria pasando
  // nada, con la persona esperando delante de la maquina.
  //
  // La senal buena es que aparezca el panel de "pausa"/"detener": eso solo lo
  // monta la app cuando hay un trabajo corriendo.
  const arranco = Boolean(after?.enMarcha)
  return {
    ok: true,
    engraved: arranco,
    ...info,
    arranco,
    verificacion,
    aviso: arranco
      ? null
      : after?.dialogo
        ? `la app sigue con un aviso abierto: "${after.dialogo}"`
        : 'se pulso el boton pero no aparecio el panel de grabado; comprueba la maquina',
    despues: after ? { route: after.route, enMarcha: after.enMarcha, dialogo: after.dialogo } : null,
  }
}

/**
 * Paso 1 del grabado: abre el proyecto y lanza la VISTA PREVIA.
 *
 * La vista previa recorre el contorno del diseno sobre la pieza sin grabar, y
 * es la unica forma de ver si la pieza esta bien colocada antes de quemarla.
 * Por eso el flujo normal para aqui y espera confirmacion humana: la landing
 * pregunta, y solo entonces se llama a `engraveNow`.
 *
 * @param {string} projectId
 * @param {object} [opts]
 * @param {string}  [opts.projectName] Titulo de la tarjeta en la galeria.
 * @param {boolean} [opts.dryRun]      Comprueba todo pero no pulsa nada.
 * @param {number}  [opts.timeoutMs]   Espera maxima a que monte el lienzo.
 */
async function openAndPreview(projectId, opts = {}, port = DEFAULT_PORT) {
  const id = String(projectId)
  const projectName = opts.projectName == null ? null : String(opts.projectName)
  const deadline = Date.now() + (Number(opts.timeoutMs) || 25000)
  const s = await openSession(port)

  try {
    const abierto = await ensureOpen(s, id, projectName, deadline)
    if (!abierto.ok) return abierto

    await wait(500) // que termine de pintar los objetos
    let ui = await leerUi(s)

    // Restos de un aviso anterior: taparia el boton de vista previa.
    if (!ui.enMarcha && ui.dialogoInfo && ui.dialogoInfo.deImpresion) {
      await pulsar(s, 'dialogoCancelar', 'cancelar del aviso anterior')
      await wait(400)
      ui = await leerUi(s)
    }

    const pega = pegaConexion(ui)
    if (pega) return { ok: false, stage: 'dispositivo', error: pega, route: ui.route, needsConnect: ui.pideConectar }
    // Ya en vista previa (una anterior que sigue abierta): no se pulsa otra vez,
    // se da por buena la que hay.
    if (ui.modo === 'vista-previa')
      return {
        ok: true,
        previewing: true,
        yaEstaba: true,
        id,
        deviceName: ui.deviceName,
        route: ui.route,
        buttonText: ui.salirPrevia ? ui.salirPrevia.texto : null,
        aviso: null,
      }
    if (ui.enMarcha)
      return {
        ok: false,
        stage: 'ocupada',
        route: ui.route,
        deviceName: ui.deviceName,
        enMarcha: ui.enMarcha,
        error: `la maquina ya esta trabajando${ui.enMarcha.progreso ? ' (' + ui.enMarcha.progreso + ')' : ''}; espera a que termine`,
      }
    if (!ui.vista)
      return {
        ok: false,
        stage: 'boton',
        deviceName: ui.deviceName,
        route: ui.route,
        error: `el boton de vista previa no esta en el panel activo (modo ${ui.modo})`,
      }

    const info = { id, deviceName: ui.deviceName, route: ui.route, buttonText: ui.vista.texto }
    if (opts.dryRun) return { ok: true, dryRun: true, previewing: false, ...info }

    const p = await pulsar(s, 'vista', 'vista previa')
    if (!p.ok) return { ok: false, stage: 'boton', deviceName: ui.deviceName, route: ui.route, error: p.error }

    // Se confirma que la app entro en el modo vista previa. Es la senal buena:
    // monta su propio panel ("Salir de vista previa" / "Siguiente") mientras el
    // laser recorre el contorno. Si eso no aparece, el click no hizo nada y hay
    // que decirlo, no dar por hecho que la maquina esta marcando la pieza.
    let after = null
    const hasta = Date.now() + 6000
    while (Date.now() < hasta) {
      await wait(400)
      after = await leerUi(s)
      if (after.modo === 'vista-previa' || after.enMarcha || after.dialogo) break
    }

    const enPrevia = after?.modo === 'vista-previa' || Boolean(after?.enMarcha)
    return {
      ok: true,
      previewing: enPrevia,
      ...info,
      modo: after?.modo || null,
      enMarcha: after?.enMarcha || null,
      aviso: enPrevia
        ? after?.dialogo || null
        : after?.dialogo
          ? `la app abrio un aviso: "${after.dialogo}"`
          : 'se pulso Vista previa pero la app no entro en modo vista previa; comprueba la maquina',
    }
  } finally {
    s.close()
  }
}

/**
 * Paso 2: graba, ya con el visto bueno de la persona.
 *
 * @param {string} projectId
 * @param {object} [opts]
 * @param {boolean} [opts.stopPreview]  Detiene la vista previa si sigue en marcha.
 * @param {string}  [opts.projectName]  Para reabrirlo si se cerro el lienzo.
 * @param {boolean} [opts.dryRun]
 */
async function engraveNow(projectId, opts = {}, port = DEFAULT_PORT) {
  const id = String(projectId)
  const projectName = opts.projectName == null ? null : String(opts.projectName)
  const deadline = Date.now() + (Number(opts.timeoutMs) || 25000)
  const s = await openSession(port)
  try {
    const abierto = await ensureOpen(s, id, projectName, deadline)
    if (!abierto.ok) return abierto
    if (abierto.reabierto) await wait(500)
    return await dispararGrabado(s, id, {
      dryRun: opts.dryRun,
      pararPrevia: opts.stopPreview !== false,
      esperado: opts.esperado,
    })
  } finally {
    s.close()
  }
}

/**
 * Abre el proyecto en el lienzo y trae la app al frente.
 *
 * Es el "realizar proyecto" de la landing: la pieza ya esta generada y lo que se
 * quiere es tenerla delante en Design Space para ajustarla a mano. No comprueba
 * nada de grabado ni toca la maquina, porque no va a grabar.
 */
async function openProject(projectId, opts = {}, port = DEFAULT_PORT) {
  const id = String(projectId)
  const projectName = opts.projectName == null ? null : String(opts.projectName)
  const deadline = Date.now() + (Number(opts.timeoutMs) || 25000)
  const s = await openSession(port)
  try {
    const abierto = await ensureOpen(s, id, projectName, deadline)
    if (!abierto.ok) return abierto

    // Traer la ventana al frente es la mitad del favor: si no, la landing dice
    // "abierto" y la app se queda detras del navegador.
    let alFrente = false
    try {
      await s.send('Page.bringToFront')
      alFrente = true
    } catch {}

    const ui = await leerUi(s)
    return {
      ok: true,
      id,
      route: ui.route,
      alFrente,
      reabierto: abierto.reabierto,
      deviceName: ui.deviceName,
      connected: ui.conexion.connected,
    }
  } finally {
    s.close()
  }
}

/**
 * Detiene lo que la app este haciendo: sale de la vista previa o para el
 * trabajo en curso, segun cual sea el panel activo.
 */
async function stopJob(port = DEFAULT_PORT) {
  const s = await openSession(port)
  try {
    const ui = await leerUi(s)
    if (ui.modo === 'vista-previa') {
      const salida = await salirVistaPrevia(s)
      return salida.ok
        ? { ok: true, yaParada: false, era: 'vista-previa', route: ui.route }
        : { ok: false, error: salida.error, era: 'vista-previa', route: ui.route }
    }
    if (!ui.enMarcha) return { ok: true, yaParada: true, route: ui.route }
    const parada = await pararTrabajo(s)
    return parada.ok
      ? { ok: true, yaParada: false, era: 'trabajo', route: ui.route }
      : { ok: false, error: parada.error, era: 'trabajo', route: ui.route }
  } finally {
    s.close()
  }
}

/**
 * Pulsa "Conecta el dispositivo" en la app.
 *
 * Conectar no mueve el laser ni dispara nada, asi que se puede hacer desde la
 * landing sin ceremonia. Solo existe dentro del lienzo, que es donde la app
 * pinta ese boton.
 */
async function connectDevice(opts = {}, port = DEFAULT_PORT) {
  const s = await openSession(port)
  try {
    let ui = await leerUi(s)
    if (ui.conexion.connected === true) return { ok: true, yaConectado: true, deviceName: ui.deviceName, route: ui.route }
    if (!ui.onCanvas)
      return {
        ok: false,
        stage: 'pantalla',
        route: ui.route,
        error: 'el boton de conectar solo existe con un diseno abierto; abre uno en Design Space o genera una pieza',
      }
    if (!ui.conectar)
      return { ok: false, stage: 'boton', route: ui.route, error: 'no aparece el boton de conectar en la app' }

    const p = await pulsar(s, 'conectar', 'conectar')
    if (!p.ok) return { ok: false, stage: 'boton', route: ui.route, error: p.error }

    const hasta = Date.now() + (Number(opts.timeoutMs) || 15000)
    while (Date.now() < hasta) {
      await wait(600)
      ui = await leerUi(s)
      if (ui.conexion.connected === true) return { ok: true, yaConectado: false, deviceName: ui.deviceName, route: ui.route }
    }
    return {
      ok: false,
      stage: 'conectar',
      route: ui.route,
      dialogo: ui.dialogo,
      error: ui.dialogo
        ? `la app pide algo mas para conectar: "${ui.dialogo}"`
        : 'la app no confirmo la conexion; comprueba que la maquina este encendida y termina de conectarla en Design Space',
    }
  } finally {
    s.close()
  }
}

/**
 * Abre y graba de una vez, sin vista previa por medio.
 *
 * Se conserva para el atajo de "grabar esto ya" (y para /api/engrave con
 * preview desactivada), pero el flujo recomendado es openAndPreview + confirmar
 * + engraveNow: quemar una pieza sin haber mirado donde va es como se estropean
 * las piezas.
 */
async function openAndEngrave(projectId, opts = {}, port = DEFAULT_PORT) {
  const id = String(projectId)
  const projectName = opts.projectName == null ? null : String(opts.projectName)
  const deadline = Date.now() + (Number(opts.timeoutMs) || 25000)
  const s = await openSession(port)
  try {
    const abierto = await ensureOpen(s, id, projectName, deadline)
    if (!abierto.ok) return abierto
    await wait(500)
    return await dispararGrabado(s, id, {
      dryRun: opts.dryRun,
      pararPrevia: Boolean(opts.stopPreview),
      esperado: opts.esperado,
    })
  } finally {
    s.close()
  }
}


module.exports = {
  evaluate,
  isAvailable,
  inspectProjectApi,
  registerViaApp,
  deleteViaApp,
  refreshGallery,
  deviceStatus,
  connectDevice,
  openProject,
  openAndPreview,
  engraveNow,
  stopJob,
  openAndEngrave,
  DEFAULT_PORT,
}
