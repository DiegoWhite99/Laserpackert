'use strict'

// La cola de gente que se ha registrado con el QR.
//
// En un evento no tiene sentido que alguien vaya escribiendo los nombres a
// mano en la landing: la gente llega, escanea el codigo, pone sus datos y se
// va con un numero. Aqui se guarda eso, y de aqui sale el lote de placas.
//
// El numero de turno NO es la posicion en la lista: es un contador que solo
// sube. Si fuera la posicion, al generar las primeras placas todo el mundo
// cambiaria de numero y el que tiene el 45 en la mano dejaria de ser el 45.
//
// El fichero es JSON plano, al lado de plantillas.json, por lo mismo que
// aquel: se puede abrir, leer y arreglar a mano sin herramientas.

const fs = require('node:fs')
const path = require('node:path')
const resources = require('./resources')

const FILE = process.env.LP_QUEUE_FILE || resources.dataFile('cola.json')

// Un evento grande son un par de cientos de personas. El limite existe para que
// nadie pueda llenar el disco desde el formulario, no porque estorben.
const MAX_REGISTROS = 1000

const vacia = () => ({ siguienteTurno: 1, registros: [] })

function leer() {
  let raw
  try {
    raw = fs.readFileSync(FILE, 'utf8')
  } catch {
    return vacia()
  }
  try {
    const datos = JSON.parse(raw)
    const registros = Array.isArray(datos?.registros) ? datos.registros.filter((r) => r && r.nombre) : []
    const turnoMax = registros.reduce((m, r) => Math.max(m, Number(r.turno) || 0), 0)
    return {
      // Si el contador guardado se quedo corto (fichero editado a mano), se
      // recoloca por encima del turno mas alto en vez de repartir repetidos.
      siguienteTurno: Math.max(Number(datos?.siguienteTurno) || 1, turnoMax + 1),
      registros,
    }
  } catch {
    console.error(`cola.json ilegible; se empieza de cero (${FILE})`)
    return vacia()
  }
}

/** Escritura atomica: un corte a media escritura no puede dejar la cola rota. */
function guardar(datos) {
  const tmp = `${FILE}.tmp`
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, FILE)
}

// --- Validacion -----------------------------------------------------------
//
// Lo que llega aqui viene de un formulario abierto a la red local, asi que se
// da por hostil: se comprueba, se recorta y se limpia de caracteres de control
// (que ademas acabarian en el nombre de una placa).

const limpiar = (v, max) =>
  String(v == null ? '' : v)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)

function validar(datos) {
  const nombre = limpiar(datos.nombre, 60)
  if (nombre.length < 2) throw new Error('Escribe tu nombre')
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(nombre))
    throw new Error('El nombre solo puede llevar letras, espacios, puntos y guiones')

  // El celular se guarda solo con digitos y un + opcional: da igual como lo
  // escriba cada uno, luego sirve para no repetir a la misma persona.
  const celularBruto = limpiar(datos.celular, 25)
  const celular = celularBruto.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
  const digitos = celular.replace(/\D/g, '')
  if (digitos.length < 7 || digitos.length > 15) throw new Error('El celular no parece un numero de telefono')

  const correo = limpiar(datos.correo, 100).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(correo)) throw new Error('El correo no parece valido')

  return { nombre, celular, correo }
}

// --- Operaciones ----------------------------------------------------------

/**
 * Mete a alguien en la cola y le da su numero.
 *
 * Si esa persona ya estaba esperando (mismo correo o mismo celular) se le
 * devuelve el numero que ya tenia en vez de darle otro: recargar la pagina no
 * puede convertir a una persona en dos placas.
 *
 * @returns {{turno: number, delante: number, repetido: boolean, registro: object}}
 */
function add(datos, meta = {}) {
  const limpio = validar(datos)
  const estado = leer()

  const yaEsta = estado.registros.find(
    (r) => r.estado === 'pendiente' && (r.correo === limpio.correo || (r.celular && r.celular === limpio.celular))
  )
  if (yaEsta) return { turno: yaEsta.turno, delante: delanteDe(estado, yaEsta.turno), repetido: true, registro: yaEsta }

  const pendientes = estado.registros.filter((r) => r.estado === 'pendiente').length
  if (pendientes >= MAX_REGISTROS) throw new Error('La cola esta llena; avisa a quien atiende el puesto')

  const registro = {
    turno: estado.siguienteTurno,
    ...limpio,
    estado: 'pendiente',
    at: new Date().toISOString(),
    // De donde vino, para poder rastrear un registro raro sin guardar nada mas.
    desde: meta.ip ? String(meta.ip).slice(0, 45) : null,
  }
  estado.siguienteTurno++
  estado.registros.push(registro)
  guardar(estado)

  return { turno: registro.turno, delante: pendientes, repetido: false, registro }
}

/** Cuantos pendientes hay por delante de un turno. */
function delanteDe(estado, turno) {
  return estado.registros.filter((r) => r.estado === 'pendiente' && r.turno < turno).length
}

/** Toda la cola, del turno mas bajo al mas alto. */
function list() {
  const { registros } = leer()
  return registros.slice().sort((a, b) => a.turno - b.turno)
}

function pendientes() {
  return list().filter((r) => r.estado === 'pendiente')
}

function resumen() {
  const todos = list()
  return {
    total: todos.length,
    pendientes: todos.filter((r) => r.estado === 'pendiente').length,
    hechos: todos.filter((r) => r.estado === 'hecho').length,
    ultimoTurno: todos.length ? todos[todos.length - 1].turno : 0,
  }
}

/**
 * Marca turnos como ya generados, guardando con que placa.
 *
 * No se borran: hace falta poder mirar a quien se le hizo la placa, y el correo
 * y el celular siguen siendo los datos con los que esa persona se registro.
 */
function marcar(turnos, placas = {}) {
  const estado = leer()
  const set = new Set(turnos.map(Number))
  let n = 0
  for (const r of estado.registros) {
    if (!set.has(r.turno) || r.estado === 'hecho') continue
    r.estado = 'hecho'
    r.hechoAt = new Date().toISOString()
    if (placas[r.turno]) r.placaId = placas[r.turno]
    n++
  }
  if (n) guardar(estado)
  return { marcados: n }
}

/** Saca turnos de la cola del todo (el que se registro y se fue). */
function quitar(turnos) {
  const estado = leer()
  const set = new Set(turnos.map(Number))
  const resto = estado.registros.filter((r) => !set.has(r.turno))
  const quitados = estado.registros.length - resto.length
  if (quitados) guardar({ ...estado, registros: resto })
  return { quitados }
}

/**
 * Vacia la cola.
 *
 * El contador de turnos NO se reinicia salvo que se pida: si en mitad del
 * evento se vacia la lista y el siguiente vuelve a ser el 1, hay dos personas
 * con el mismo numero en la mano.
 */
function vaciar({ reiniciarTurnos = false } = {}) {
  const estado = leer()
  const borrados = estado.registros.length
  guardar({ siguienteTurno: reiniciarTurnos ? 1 : estado.siguienteTurno, registros: [] })
  return { borrados }
}

module.exports = { add, list, pendientes, resumen, marcar, quitar, vaciar, validar, FILE, MAX_REGISTROS }
