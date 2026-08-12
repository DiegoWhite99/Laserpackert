'use strict'

// Las dimensiones en pixeles son obligatorias: el .lpproject guarda
// width/height en pixeles del origen y luego escala a mm con scaleX/scaleY.
// Sin el tamano real la imagen sale deformada en el lienzo.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), mime: 'image/png' }
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    // SOF0..SOF15, saltando DHT (c4), JPG (c8) y DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), mime: 'image/jpeg' }
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

/**
 * @param {Buffer} buf
 * @returns {{width: number, height: number, mime: string}}
 * @throws si el formato no es PNG ni JPEG
 */
function imageSize(buf) {
  const size = pngSize(buf) || jpegSize(buf)
  if (!size) throw new Error('Formato no reconocido: se admite PNG o JPEG')
  if (!size.width || !size.height) throw new Error('La imagen declara dimensiones invalidas')
  return size
}

module.exports = { imageSize }
