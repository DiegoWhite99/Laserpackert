'use strict'

// Empaqueta src/ en un solo fichero CommonJS y escribe la configuracion de SEA.
//
// Node SEA solo acepta UN script, y dentro del ejecutable `require('./algo')` no
// resuelve nada: solo funcionan los modulos nativos. Asi que los modulos de
// src/ se meten en un registro propio y sus `require('./x')` pasan a leer de ahi.
// Los `require('node:...')` se quedan como estan, que si funcionan.
//
// No se usa ningun bundler de npm a proposito: el proyecto no tiene ni una
// dependencia y esto son 40 lineas de reescritura sobre requires relativos.
//
//   node build/bundle.js
//
// Deja en build/out/: app.cjs (el bundle) y sea-config.json (con rutas absolutas,
// para que dar con el blob no dependa de desde donde se lance el build).

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const OUT = path.join(__dirname, 'out')
const ENTRY = 'server'

/** `require('./templates')` / `require("./zip.js")` -> el modulo del registro. */
const RELATIVE_REQUIRE = /require\(\s*(['"])\.\/([^'"]+)\1\s*\)/g

const moduleId = (spec) => spec.replace(/^\.\//, '').replace(/\.js$/, '')

/** Recoge el modulo y, en cascada, todo lo que pida con `./`. */
function collect(id, modules = new Map()) {
  if (modules.has(id)) return modules
  const file = path.join(SRC, `${id}.js`)
  if (!fs.existsSync(file)) throw new Error(`No existe src/${id}.js (lo pide el bundle)`)

  const code = fs.readFileSync(file, 'utf8')
  modules.set(id, code)
  for (const m of code.matchAll(RELATIVE_REQUIRE)) collect(moduleId(m[2]), modules)
  return modules
}

function emit(modules) {
  const parts = [
    "'use strict'",
    '',
    '// GENERADO por build/bundle.js -- no editar a mano.',
    '// Los modulos de src/ tal cual, con sus requires relativos redirigidos al',
    '// registro de abajo. Cualquier arreglo va en src/ y se vuelve a construir.',
    '',
    'const __mods = {}',
    'const __cache = {}',
    '',
    'function __local(id) {',
    "  const key = String(id).replace(/^\\.\\//, '').replace(/\\.js$/, '')",
    '  const hit = __cache[key]',
    '  if (hit) return hit.exports',
    '  const factory = __mods[key]',
    "  if (!factory) throw new Error('modulo no empaquetado: ' + id)",
    '  const mod = (__cache[key] = { exports: {} })',
    '  factory(mod, mod.exports, __local)',
    '  return mod.exports',
    '}',
    '',
  ]

  for (const [id, code] of modules) {
    // El tercer parametro se llama `require` a proposito: asi el codigo de src/
    // entra sin tocar mas que la ruta, y los `require('node:fs')` siguen yendo
    // al require de verdad porque el nombre solo se usa con './'.
    parts.push(`__mods[${JSON.stringify(id)}] = function (module, exports, __rel) {`)
    parts.push(code.replace(RELATIVE_REQUIRE, (_, __, spec) => `__rel(${JSON.stringify(moduleId(spec))})`))
    parts.push('}')
    parts.push('')
  }

  parts.push(`__local(${JSON.stringify(ENTRY)})`)
  parts.push('')
  return parts.join('\n')
}

/** Recursos que el puente lee en marcha y tienen que viajar dentro del .exe. */
function assets() {
  const map = {}
  const add = (rel) => {
    map[rel.replace(/\\/g, '/')] = path.join(ROOT, rel)
  }

  // La landing entera, con lo que le cuelgue (hoy solo index.html).
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name)
      if (e.isDirectory()) walk(rel)
      // desktop.ini lo pone Windows al personalizar la carpeta; no es un recurso.
      else if (e.name !== 'desktop.ini') add(rel)
    }
  }
  walk('public')

  add(path.join('assets', 'divergency-logo-original.png'))
  add(path.join('assets', 'divergency-logo-src.png'))
  add('launch-app.ps1') // lo ejecuta el modo en vivo; se extrae a disco al usarlo

  return map
}

fs.mkdirSync(OUT, { recursive: true })

const modules = collect(ENTRY)
const bundle = emit(modules)
const bundlePath = path.join(OUT, 'app.cjs')
fs.writeFileSync(bundlePath, bundle, 'utf8')

const embedded = assets()
const configPath = path.join(OUT, 'sea-config.json')
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: path.join(OUT, 'puente.blob'),
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      // El code cache lo genera el mismo node que construye el .exe, que es el
      // que lo va a leer: recorta el arranque sin riesgo de version cruzada.
      useCodeCache: true,
      assets: embedded,
    },
    null,
    2
  ) + '\n',
  'utf8'
)

console.log(`bundle  -> ${path.relative(ROOT, bundlePath)}  (${modules.size} modulos, ${(bundle.length / 1024).toFixed(1)} KB)`)
console.log(`         ${[...modules.keys()].join(', ')}`)
console.log(`recursos -> ${Object.keys(embedded).length}: ${Object.keys(embedded).join(', ')}`)
console.log(`config  -> ${path.relative(ROOT, configPath)}`)
