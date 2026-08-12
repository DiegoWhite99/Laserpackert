'use strict'

// Registro del proyecto en MainProject.db, el SQLite que alimenta la
// galeria de LaserPecker Design Space.
//
// La app mantiene el fichero abierto mientras corre, asi que toda
// escritura puede topar con SQLITE_BUSY. El registro es best-effort:
// si falla, el .lp2 ya existe en disco y sigue abriendose con
// Archivo > Abrir. Nunca se aborta la peticion por esto.

const path = require('node:path')
const os = require('node:os')

// Configurable como el resto de rutas (LP_PROJECT_DIR, LP_TEMPLATES_FILE): era
// la unica fija, y eso hace que no se pueda probar el puente de punta a punta
// sin escribir en la galeria de verdad. `os.homedir()` no sirve para desviarla:
// en Windows sale del token del usuario, no de USERPROFILE.
const DB_PATH =
  process.env.LP_DB_FILE ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'laserpecker_design_spaces', 'db', 'MainProject.db')

const INSERT = `
INSERT INTO lp_project
  (id, create_time, update_time, local_version, server_version,
   file_id, file_name, width, height, hwVersion, swVersion,
   preview_img, path, version, sourcePath, isLoadSourcePath, remarks, status)
VALUES
  (?, ?, ?, 0, 0, ?, ?, ?, ?, 12288, 10300, ?, ?, 2, '', 0, '', 0)
`

function openDb() {
  // node:sqlite es experimental y emite un warning en stderr; se silencia
  // porque este proceso es una herramienta local, no una libreria.
  const { DatabaseSync } = require('node:sqlite')
  return new DatabaseSync(DB_PATH, { timeout: 4000 })
}

/**
 * @returns {{registered: boolean, reason?: string}}
 */
function registerProject({ fileId, name, widthMm, heightMm, previewDataUri, filePath, createTime }) {
  let db
  try {
    db = openDb()
    db.prepare(INSERT).run(
      fileId,
      createTime,
      createTime,
      fileId,
      name,
      widthMm,
      heightMm,
      previewDataUri,
      filePath
    )
    return { registered: true }
  } catch (err) {
    return { registered: false, reason: err.message }
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

function listProjects() {
  let db
  try {
    db = openDb()
    return db
      .prepare(
        `SELECT id, file_id, file_name, width, height, create_time, update_time, path, status
         FROM lp_project
         WHERE deleted_date IS NULL
         ORDER BY update_time DESC
         LIMIT 500`
      )
      .all()
  } catch {
    return []
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

/**
 * Manda proyectos a la papelera de la app.
 *
 * NO se borra la fila: la app trabaja con borrado blando (por eso tiene
 * RestoreByIdAsync), asi que se rellena `deleted_date` igual que hace ella.
 * Un boton de "vaciar la galeria" que borrara de verdad no tendria vuelta
 * atras, y aqui la tiene.
 *
 * En el formato de fecha de la tabla, que es texto y en UTC, como el
 * `datetime('now')` que la propia tabla usa por defecto.
 *
 * @param {string[]} ids
 * @returns {{borrados: number, error?: string}}
 */
function deleteProjects(ids) {
  const lista = [...new Set((ids || []).map(String))].filter((id) => /^[0-9a-fA-F-]{8,64}$/.test(id))
  if (!lista.length) return { borrados: 0 }

  const cuando = new Date().toISOString().slice(0, 19).replace('T', ' ')
  let db
  try {
    db = openDb()
    const stmt = db.prepare('UPDATE lp_project SET deleted_date = ? WHERE id = ? AND deleted_date IS NULL')
    let n = 0
    for (const id of lista) n += stmt.run(cuando, id).changes
    return { borrados: n }
  } catch (err) {
    return { borrados: 0, error: err.message }
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

/** @returns {{id: string, file_name: string}|null} */
function findProject(id) {
  let db
  try {
    db = openDb()
    return db.prepare('SELECT id, file_name, path FROM lp_project WHERE id = ?').get(String(id)) ?? null
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

module.exports = { registerProject, listProjects, findProject, deleteProjects, DB_PATH }
