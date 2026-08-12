'use strict'

// Plantillas de grabado: logo fijo arriba, nombre centrado debajo.
//
// Toda la geometria sale por ingenieria inversa de proyectos reales hechos
// a mano en Design Space. Se conserva al decimal para que lo generado salga
// identico a lo que se aprobo en pantalla.
//
//   placa   <- b514505c...lp2  (cartulina, 41.7 x 26.5 mm)
//   esfero  <- "divergency esfero.lp2"  (oxido de aluminio, 11.9 x 7.3 mm)

// --- Metricas de fuente ---------------------------------------------------
//
// Anchos de avance de Times New Roman en unidades de fuente (2048 por em, que es
// lo que declara el propio TTF).
//
// No son las metricas AFM de Times Roman, que es lo que habia antes: se parecen
// pero no son iguales, y el ancho salia con un error de unas milesimas. Estan
// medidos con `canvas.measureText` en Chromium, que es el mismo camino por el que
// mide Design Space (Electron + fabric.js), asi que el resultado es el de la app
// y no una aproximacion.
//
// Verificado contra los dos proyectos reales, al bit:
//   "Jarvey"             -> 31.318359375   (divergency esfero.lp2)
//   "Diego Castelblanco" -> 94.306640625   (formato Esfero.lp2)
//
// Para volver a medirlos (otra fuente, otra version de la app), la receta esta
// en el README: 12px "Times New Roman", avance * 2048 / 12.
const TIMES_UNITS_PER_EM = 2048
const TIMES_WIDTHS = {
  0: 1024, 1: 1024, 2: 1024, 3: 1024, 4: 1024, 5: 1024, 6: 1024, 7: 1024, 8: 1024, 9: 1024,
  A: 1479, B: 1366, C: 1366, D: 1479, E: 1251, F: 1139, G: 1479, H: 1479, I: 682, J: 797, K: 1479, L: 1251, M: 1821,
  N: 1479, O: 1479, P: 1139, Q: 1479, R: 1366, S: 1139, T: 1251, U: 1479, V: 1479, W: 1933, X: 1479, Y: 1479, Z: 1251,
  a: 909, b: 1024, c: 909, d: 1024, e: 909, f: 682, g: 1024, h: 1024, i: 569, j: 569, k: 1024, l: 569, m: 1593,
  n: 1024, o: 1024, p: 1024, q: 1024, r: 682, s: 797, t: 569, u: 1024, v: 1024, w: 1479, x: 1024, y: 1024, z: 909,
  ' ': 512, '!': 682, '"': 836, '#': 1024, $: 1024, '%': 1706, '&': 1593, "'": 369,
  '(': 682, ')': 682, '*': 1024, '+': 1155, ',': 512, '-': 682, '.': 512, '/': 569,
  ':': 569, ';': 569, '<': 1155, '=': 1155, '>': 1155, '?': 909, '@': 1886,
  '[': 682, '\\': 569, ']': 682, '^': 961, _: 1024, '`': 682,
  '{': 983, '|': 410, '}': 983, '~': 1108,
  // Con acentos no hace falta descomponer nada: la fuente los trae y miden lo
  // mismo que su letra base, pero medido es mejor que supuesto.
  á: 909, é: 909, í: 569, ó: 1024, ú: 1024, ü: 1024, ñ: 1024,
  Á: 1479, É: 1251, Í: 682, Ó: 1479, Ú: 1479, Ü: 1479, Ñ: 1479,
  à: 909, è: 909, ì: 569, ò: 1024, ù: 1024, â: 909, ê: 909, î: 569, ô: 1024, û: 1024,
  ä: 909, ë: 909, ï: 569, ö: 1024, ç: 909, Ç: 1366, '¿': 909, '¡': 682, º: 635, ª: 565,
}

/**
 * Ancho de un texto en unidades de objeto.
 *
 * Con metricas conocidas (Times New Roman) sale exacto: es el mismo numero que
 * declara la app. Para el resto se usa el ancho medio de glifo medido en el
 * proyecto original, que es una estimacion: la app remide con la fuente real al
 * abrir, asi que nombres de glifos muy anchos pueden quedar un poco descentrados.
 */
function measureText(text, { fontSize, charRatio, widths, unitsPerEm }) {
  if (!widths) return text.length * fontSize * charRatio

  const em = unitsPerEm ?? 1000
  const porDefecto = widths.n ?? em / 2
  let total = 0
  for (const ch of text) {
    // La tabla ya trae los acentos medidos. Para lo que no este se prueba con la
    // letra base -- la primera de su descomposicion -- antes de rendirse.
    total += widths[ch] ?? widths[ch.normalize('NFD')[0]] ?? porDefecto
  }
  return (total / em) * fontSize
}

// --- Plantillas -----------------------------------------------------------

const TEMPLATES = {
  esfero: {
    id: 'esfero',
    label: 'Esfero',
    material: 'Óxido de aluminio',
    logo: {
      pxWidth: 300,
      pxHeight: 119,
      left: 61.87461680294764,
      top: 46.10206691301063,
      scaleX: 0.039531683651796996,
      scaleY: 0.03917534998334469,
      printPower: 65,
      printDepth: 30,
    },
    text: {
      top: 50.76393356102865,
      scaleX: 0.2366024321796071,
      scaleY: 0.19616519174041344,
      objectHeight: 13.559999999999999,
      fontSize: 12,
      fontFamily: 'Times New Roman',
      fontStyle: '',
      lineHeight: 1.1,
      printPower: 73,
      printDepth: 15,
      widths: TIMES_WIDTHS,
      unitsPerEm: TIMES_UNITS_PER_EM,
    },
    laserMaterial: {
      materialId: 'aluminum_0_10',
      materialKey: 'aluminum',
      materialName: 'Óxido de aluminio',
    },
    // El proyecto del esfero no lleva fanLevel/pump en las capas de grabado.
    airAssist: false,
  },

  // Sale de "formato Esfero.lp2" (11/08/2026). No es el esfero de arriba con
  // otras potencias: cambia la disposicion (el nombre va AL LADO del logo, no
  // debajo), el material es acrilico y la capa del texto graba a 4K.
  'esfero-linea': {
    id: 'esfero-linea',
    label: 'Esfero en línea',
    material: 'Acrílico',
    // El nombre a la derecha del logo, pegado a su borde y centrado con el.
    arrange: 'linea',
    logo: {
      pxWidth: 300,
      pxHeight: 119,
      left: 40.764920620455825,
      top: 48.97253853765574,
      scaleX: 0.052937593428903654,
      scaleY: 0.052460420560889454,
      printPower: 5,
      printDepth: 20,
    },
    text: {
      // Este top ya deja el texto centrado con el logo: las dos alturas son
      // fijas (6.2428 y 2.66 mm), asi que el centrado no depende del nombre.
      top: 50.76393356102865,
      scaleX: 0.2366024321796071,
      scaleY: 0.19616519174041344,
      objectHeight: 13.559999999999999,
      fontSize: 12,
      fontFamily: 'Times New Roman',
      fontStyle: '',
      lineHeight: 1.1,
      printPower: 20,
      printDepth: 14,
      widths: TIMES_WIDTHS,
      unitsPerEm: TIMES_UNITS_PER_EM,
    },
    laserMaterial: {
      materialId: 'acrylic_0_10',
      materialKey: 'acrylic',
      materialName: 'Acrílico',
    },
    // La capa del texto graba a 4K, no a 1K como en el resto de plantillas, y
    // el aire aparece solo en la del logo y con valor 0. Copiado del proyecto.
    layers: {
      layerFill: { dpi: 846.66666, px: 1, des: '4K' },
      layerPicture: { fanLevel: 0, pump: 0 },
    },
    airAssist: false,
  },

  placa: {
    id: 'placa',
    label: 'Placa',
    material: 'Cartulina',
    logo: {
      pxWidth: 300,
      pxHeight: 119,
      left: 27.092661128138637,
      top: 32.89677475564266,
      scaleX: 0.13906264472739224,
      scaleY: 0.1378091513832468,
      printPower: 14,
      printDepth: 5,
    },
    text: {
      top: 49.29606377024903,
      scaleX: 0.5969161786971131,
      scaleY: 0.7459956442207459,
      objectHeight: 13.559999999999999,
      fontSize: 12,
      fontFamily: 'AgencyFB-Reg',
      fontStyle: 'italic',
      lineHeight: 1.1,
      printPower: 27,
      printDepth: 26,
      // AgencyFB es condensada y no hay metricas publicas: se usa el ancho
      // medio medido en el original ("Viviana Jimenez" = 60.1640625 a 12 pt).
      charRatio: 60.1640625 / (15 * 12),
    },
    laserMaterial: {
      materialId: 'paper_jam_0_10',
      materialKey: 'paper_jam',
      materialName: 'Cartulina',
    },
    airAssist: true,
  },
}

const DEFAULT_TEMPLATE = 'esfero'

// --- Plantillas propias ---------------------------------------------------
//
// Las de arriba son geometria sacada de proyectos reales y no se tocan. Una
// plantilla propia es una de esas MAS los ajustes de laser que se han probado
// en la maquina: potencia y profundidad, que es lo que de verdad cambia al
// afinar un material. La geometria sigue siendo la de la base, asi que guardar
// ajustes no puede descolocar un diseno que ya salia bien.

const fs = require('node:fs')
const resources = require('./resources')

// En el repo, al lado del codigo. En el .exe, en %LOCALAPPDATA%: el ejecutable
// puede estar en una carpeta donde no se pueda escribir.
const CUSTOM_FILE = process.env.LP_TEMPLATES_FILE || resources.dataFile('plantillas.json')

let cache = { mtimeMs: -1, list: [] }

/** Lee el fichero de plantillas propias; relee solo si ha cambiado. */
function loadCustom() {
  let st
  try {
    st = fs.statSync(CUSTOM_FILE)
  } catch {
    cache = { mtimeMs: -1, list: [] }
    return cache.list
  }
  if (st.mtimeMs === cache.mtimeMs) return cache.list
  try {
    const raw = JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8'))
    const list = Array.isArray(raw) ? raw.filter((t) => t && t.id && t.base && TEMPLATES[t.base]) : []
    cache = { mtimeMs: st.mtimeMs, list }
  } catch {
    // Un fichero corrupto no puede tumbar el puente: se ignora y se avisa.
    console.error(`plantillas.json ilegible; se ignora (${CUSTOM_FILE})`)
    cache = { mtimeMs: st.mtimeMs, list: [] }
  }
  return cache.list
}

function saveAll(list) {
  fs.writeFileSync(CUSTOM_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8')
  cache = { mtimeMs: -1, list } // que la proxima lectura vuelva al disco
}

function slug(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** Una plantilla propia resuelta: la base con los ajustes encima. */
function resolveCustom(c) {
  const base = TEMPLATES[c.base]
  const num = (v, alt) => (Number.isFinite(Number(v)) ? Number(v) : alt)
  return {
    ...base,
    id: c.id,
    label: c.label || c.id,
    material: c.material || base.material,
    custom: true,
    base: c.base,
    logo: {
      ...base.logo,
      printPower: num(c.logoPower, base.logo.printPower),
      printDepth: num(c.logoDepth, base.logo.printDepth),
    },
    text: {
      ...base.text,
      printPower: num(c.textPower, base.text.printPower),
      printDepth: num(c.textDepth, base.text.printDepth),
    },
  }
}

/**
 * Guarda (o actualiza) una plantilla propia.
 * @returns {{id: string, label: string}}
 */
function saveTemplate(spec) {
  const base = String(spec.base || DEFAULT_TEMPLATE).toLowerCase()
  if (!TEMPLATES[base]) throw new Error(`La plantilla base no existe: ${base}`)

  const label = String(spec.label || '').trim().replace(/\s+/g, ' ')
  if (label.length < 2) throw new Error('Ponle un nombre a la plantilla (al menos 2 caracteres)')
  if (label.length > 40) throw new Error('El nombre de la plantilla es demasiado largo (maximo 40)')

  const id = slug(label)
  if (!id) throw new Error('Ese nombre no deja ningun caracter usable')
  if (TEMPLATES[id]) throw new Error(`"${label}" es el nombre de una plantilla base; elige otro`)

  const limpio = (v, campo) => {
    if (v === undefined || v === null || v === '') return undefined
    const n = Number(v)
    if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error(`${campo} debe ir de 1 a 100 (llego ${v})`)
    return Math.round(n)
  }

  const entrada = {
    id,
    label,
    base,
    material: spec.material ? String(spec.material).slice(0, 60) : TEMPLATES[base].material,
    logoPower: limpio(spec.logoPower, 'La potencia del logo'),
    logoDepth: limpio(spec.logoDepth, 'La profundidad del logo'),
    textPower: limpio(spec.textPower, 'La potencia del nombre'),
    textDepth: limpio(spec.textDepth, 'La profundidad del nombre'),
    creada: spec.creada || new Date().toISOString(),
  }

  const list = loadCustom().slice()
  const i = list.findIndex((t) => t.id === id)
  if (i === -1) list.push(entrada)
  else list[i] = { ...list[i], ...entrada, creada: list[i].creada }
  saveAll(list)
  return { id, label, actualizada: i !== -1 }
}

function deleteTemplate(id) {
  const key = String(id || '').toLowerCase()
  if (TEMPLATES[key]) throw new Error('Las plantillas base no se pueden borrar')
  const list = loadCustom()
  const resto = list.filter((t) => t.id !== key)
  if (resto.length === list.length) return { borrada: false }
  saveAll(resto)
  return { borrada: true }
}

/** Todas las plantillas disponibles, base primero. */
function allTemplates() {
  return [...Object.values(TEMPLATES), ...loadCustom().map(resolveCustom)]
}

/**
 * Geometria derivada: tamanos en mm y posicion del nombre.
 *
 * Dos disposiciones, las dos copiadas de proyectos reales:
 *
 *   'debajo' (por defecto)  el nombre centrado bajo el logo   -> esfero, placa
 *   'linea'                 el nombre a la derecha, pegado al  -> esfero-linea
 *                           borde del logo
 *
 * En 'linea' el nombre no se centra: arranca exactamente donde acaba el logo,
 * que es lo que hace el proyecto original (su text.left coincide al decimal con
 * logo.left + ancho del logo). El centrado vertical ya lo da text.top, porque
 * las dos alturas son fijas.
 */
function layout(template, name) {
  const { logo, text } = template
  const logoMmWidth = logo.pxWidth * logo.scaleX
  const logoMmHeight = logo.pxHeight * logo.scaleY

  const objectWidth = measureText(name, text)
  const textMmWidth = objectWidth * text.scaleX
  const textMmHeight = text.objectHeight * text.scaleY

  const textLeft =
    template.arrange === 'linea' ? logo.left + logoMmWidth : logo.left + logoMmWidth / 2 - textMmWidth / 2

  // El alto sale del rectangulo que contiene a los dos objetos. Antes se
  // calculaba dando por hecho que el texto quedaba debajo; en 'linea' el que
  // sobresale es el logo, y esa cuenta habria dado un alto de menos.
  const minX = Math.min(logo.left, textLeft)
  const maxX = Math.max(logo.left + logoMmWidth, textLeft + textMmWidth)
  const minY = Math.min(logo.top, text.top)
  const maxY = Math.max(logo.top + logoMmHeight, text.top + textMmHeight)

  return {
    logoMmWidth,
    logoMmHeight,
    objectWidth,
    textMmWidth,
    textMmHeight,
    textLeft,
    widthMm: maxX - minX,
    heightMm: maxY - minY,
  }
}

function getTemplate(id) {
  const key = String(id || DEFAULT_TEMPLATE).toLowerCase()
  if (TEMPLATES[key]) return TEMPLATES[key]

  const propia = loadCustom().find((t) => t.id === key)
  if (propia) return resolveCustom(propia)

  const opciones = [...Object.keys(TEMPLATES), ...loadCustom().map((t) => t.id)]
  throw new Error(`Plantilla desconocida: ${id}. Opciones: ${opciones.join(', ')}`)
}

module.exports = {
  TEMPLATES,
  DEFAULT_TEMPLATE,
  getTemplate,
  allTemplates,
  saveTemplate,
  deleteTemplate,
  layout,
  measureText,
  TIMES_WIDTHS,
  CUSTOM_FILE,
}
