'use strict'

// Escritor ZIP minimo con entradas STORED (sin compresion).
// Los .lp2 que genera LaserPecker usan STORED -- se ve en que
// CompressedLength == Length en todas sus entradas -- asi que no
// hace falta deflate y el formato queda byte-compatible.

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function dosDateTime(date) {
  const time =
    (Math.floor(date.getSeconds() / 2) & 0x1f) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getHours() & 0x1f) << 11)
  const day =
    (date.getDate() & 0x1f) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (((date.getFullYear() - 1980) & 0x7f) << 9)
  return { time, day }
}

/**
 * @param {Array<{name: string, data?: Buffer, dir?: boolean}>} entries
 * @param {Date} mtime
 * @returns {Buffer}
 */
function createZip(entries, mtime = new Date()) {
  const { time, day } = dosDateTime(mtime)
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const isDir = entry.dir === true
    const name = Buffer.from(isDir && !entry.name.endsWith('/') ? entry.name + '/' : entry.name, 'utf8')
    const data = isDir ? Buffer.alloc(0) : entry.data
    const crc = isDir ? 0 : crc32(data)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0) // firma
    local.writeUInt16LE(10, 4) // version necesaria
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // metodo: stored
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18) // tamano comprimido
    local.writeUInt32LE(data.length, 22) // tamano original
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra
    name.copy(local, 30)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version creador
    central.writeUInt16LE(10, 6) // version necesaria
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comentario
    central.writeUInt16LE(0, 34) // disco
    central.writeUInt16LE(0, 36) // attrs internos
    central.writeUInt32LE(isDir ? 0x10 : 0, 38) // attrs externos: directorio
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // disco
  eocd.writeUInt16LE(0, 6) // disco del directorio central
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comentario

  return Buffer.concat([...locals, centralBuf, eocd])
}

module.exports = { createZip, crc32 }
