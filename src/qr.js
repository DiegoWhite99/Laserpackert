'use strict'

// Generador de codigos QR, en modo byte y correccion M.
//
// Hace falta uno porque el registro por QR tiene que funcionar en el sitio del
// evento, donde puede no haber internet: pedirle la imagen a un servicio de
// fuera seria un cuadro vacio justo cuando hay gente esperando para escanearlo.
// Y este proyecto no tiene ni una dependencia, asi que tampoco entra una
// libreria por esto.
//
// Se queda a proposito en lo minimo que hace falta:
//
//   modo byte        una URL, no numeros ni kanji
//   nivel M          ~15% de recuperacion; un cartel impreso no se ensucia tanto
//   versiones 1..10  hasta 213 bytes, y una URL de LAN son unos 25
//
// La salida es SVG y no PNG a proposito: son cuatro rectangulos, no hace falta
// comprimir nada, y escala a cualquier tamano de impresion sin pixelarse.
//
// Verificado modulo a modulo contra `qrcode` de Python (implementacion ajena)
// en las versiones 1, 2, 4, 5 y 8: fijando la misma mascara, las dos matrices
// salen identicas. Un QR "casi bien" se imprime igual de bonito y no lo lee
// ningun movil, asi que compararlo con algo de fuera no era opcional.

// --- GF(256) --------------------------------------------------------------
//
// La aritmetica de Reed-Solomon vive en el cuerpo de 256 elementos con el
// polinomio primitivo 0x11d, que es el que fija la norma para QR.

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  // La cola duplicada evita un modulo en cada multiplicacion.
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/**
 * Polinomio generador de `grado` codewords de correccion: el producto de
 * (x - a^i) para i de 0 a grado-1, con los coeficientes de mayor grado primero.
 */
function generator(grado) {
  let poly = [1]
  for (let i = 0; i < grado; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      // Multiplicar por x conserva el indice (el array crece por la derecha);
      // multiplicar por a^i lo corre uno. Al reves sale el polinomio invertido,
      // que tambien produce ecc de aspecto razonable pero que ningun lector
      // reconoce.
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** Los `ecLen` codewords de correccion de un bloque de datos. */
function ecCodewords(data, ecLen) {
  const gen = generator(ecLen)
  const res = new Uint8Array(data.length + ecLen)
  res.set(data)
  for (let i = 0; i < data.length; i++) {
    const factor = res[i]
    if (!factor) continue
    for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], factor)
  }
  return res.slice(data.length)
}

// --- Tablas de la norma ---------------------------------------------------
//
// Solo el nivel M, versiones 1 a 10. Cada fila es [codewords totales,
// codewords de correccion por bloque, bloques cortos, bloques largos].
// Los bloques largos llevan un codeword de datos mas que los cortos.

const VERSIONES = {
  1: { total: 26, ec: 10, g1: 1, g2: 0 },
  2: { total: 44, ec: 16, g1: 1, g2: 0 },
  3: { total: 70, ec: 26, g1: 1, g2: 0 },
  4: { total: 100, ec: 18, g1: 2, g2: 0 },
  5: { total: 134, ec: 24, g1: 2, g2: 0 },
  6: { total: 172, ec: 16, g1: 4, g2: 0 },
  7: { total: 196, ec: 18, g1: 4, g2: 0 },
  8: { total: 242, ec: 22, g1: 2, g2: 2 },
  9: { total: 292, ec: 22, g1: 3, g2: 2 },
  10: { total: 346, ec: 26, g1: 4, g2: 1 },
}

/** Centros de los patrones de alineacion por version. */
const ALINEACION = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
}

/** Codewords de datos que caben en una version (total menos los de correccion). */
function capacidadDatos(v) {
  const { total, ec, g1, g2 } = VERSIONES[v]
  return total - ec * (g1 + g2)
}

/** Bytes utiles en modo byte: descontando cabecera y contador de longitud. */
function capacidadBytes(v) {
  // El contador de caracteres pasa de 8 a 16 bits a partir de la version 10.
  const cabecera = v < 10 ? 2 : 3
  return capacidadDatos(v) - cabecera
}

// --- Bits -----------------------------------------------------------------

class Bits {
  constructor() {
    this.bytes = []
    this.length = 0
  }
  push(valor, n) {
    for (let i = n - 1; i >= 0; i--) {
      const bit = (valor >>> i) & 1
      const pos = this.length & 7
      if (pos === 0) this.bytes.push(0)
      if (bit) this.bytes[this.bytes.length - 1] |= 0x80 >> pos
      this.length++
    }
  }
}

/**
 * Los codewords finales, ya con correccion e intercalados.
 *
 * La norma no pone los bloques uno detras de otro: los intercala codeword a
 * codeword para que una mancha en el papel reparta el dano entre todos los
 * bloques en vez de destrozar uno entero.
 */
function codewords(datos, v) {
  const { ec, g1, g2 } = VERSIONES[v]
  const cortos = Math.floor(capacidadDatos(v) / (g1 + g2))

  const bloques = []
  let pos = 0
  for (let i = 0; i < g1 + g2; i++) {
    const n = i < g1 ? cortos : cortos + 1
    const data = datos.slice(pos, pos + n)
    pos += n
    bloques.push({ data, ec: ecCodewords(data, ec) })
  }

  const out = []
  for (let i = 0; i < cortos + 1; i++) for (const b of bloques) if (i < b.data.length) out.push(b.data[i])
  for (let i = 0; i < ec; i++) for (const b of bloques) out.push(b.ec[i])
  return Uint8Array.from(out)
}

/** El flujo de bits de un texto: modo byte, longitud, datos y relleno. */
function bitstream(bytes, v) {
  const bits = new Bits()
  bits.push(0b0100, 4) // modo byte
  bits.push(bytes.length, v < 10 ? 8 : 16)
  for (const b of bytes) bits.push(b, 8)

  const capacidad = capacidadDatos(v) * 8
  // Terminador: hasta cuatro ceros, y solo los que quepan.
  bits.push(0, Math.min(4, capacidad - bits.length))
  if (bits.length & 7) bits.push(0, 8 - (bits.length & 7))

  const datos = Uint8Array.from(bits.bytes)
  const relleno = new Uint8Array(capacidadDatos(v))
  relleno.set(datos)
  // Los dos bytes de relleno que fija la norma, alternados.
  for (let i = datos.length; i < relleno.length; i++) relleno[i] = (i - datos.length) % 2 === 0 ? 0xec : 0x11
  return relleno
}

// --- Informacion de formato y version -------------------------------------
//
// Se calculan en vez de tabularse: son dos BCH cortos y una tabla copiada a
// mano es justo donde se cuela una errata que nadie ve hasta que un movil no
// lee el codigo.

/** 15 bits: nivel de correccion + mascara, con BCH(15,5) y la mascara fija. */
function infoFormato(mascara) {
  const datos = (0b00 << 3) | mascara // 00 = nivel M
  let resto = datos << 10
  for (let i = 14; i >= 10; i--) if ((resto >>> i) & 1) resto ^= 0x537 << (i - 10)
  return ((datos << 10) | resto) ^ 0x5412
}

/** 18 bits con la version, solo a partir de la 7. */
function infoVersion(v) {
  let resto = v << 12
  for (let i = 17; i >= 12; i--) if ((resto >>> i) & 1) resto ^= 0x1f25 << (i - 12)
  return (v << 12) | resto
}

// --- La matriz ------------------------------------------------------------

// Cada celda es -1 (libre), 0/1 (patron fijo) o 2/3 (dato, o sea 0/1 mas DATO).
// El marcador de dato hace falta porque la mascara solo se aplica sobre los
// modulos de datos, nunca sobre los patrones.
const LIBRE = -1
const DATO = 2

function patrones(v) {
  const size = v * 4 + 17
  const m = Array.from({ length: size }, () => new Int8Array(size).fill(LIBRE))

  const set = (x, y, valor) => {
    if (x >= 0 && y >= 0 && x < size && y < size) m[y][x] = valor
  }

  // Los tres ojos, con su separador blanco.
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const dentro = x >= 0 && x <= 6 && y >= 0 && y <= 6
        const anillo = x === 0 || x === 6 || y === 0 || y === 6
        const centro = x >= 2 && x <= 4 && y >= 2 && y <= 4
        set(ox + x, oy + y, dentro && (anillo || centro) ? 1 : 0)
      }
    }
  }

  // Reserva de la informacion de formato: se rellena al final, cuando se sabe
  // que mascara gana. Las dos copias NO son simetricas -- la segunda son 8
  // modulos en horizontal y 7 en vertical, porque el que falta es el modulo
  // negro fijo. Reservar uno de mas corre todos los datos de sitio y el codigo
  // sale con buena pinta pero ilegible.
  for (let i = 0; i <= 8; i++) {
    if (i === 6) continue // ese cruce es sincronismo, no formato
    set(i, 8, 0)
    set(8, i, 0)
  }
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, 0)
  for (let i = 0; i < 7; i++) set(8, size - 1 - i, 0)
  set(8, size - 8, 1) // el modulo negro que siempre esta

  // Lineas de sincronismo.
  for (let i = 8; i < size - 8; i++) {
    const valor = i % 2 === 0 ? 1 : 0
    if (m[6][i] === LIBRE) m[6][i] = valor
    if (m[i][6] === LIBRE) m[i][6] = valor
  }

  // Patrones de alineacion: en todos los cruces menos los que pisan un ojo.
  const centros = ALINEACION[v]
  for (const cy of centros) {
    for (const cx of centros) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === centros[centros.length - 1]) ||
          (cy === 6 && cx === centros[centros.length - 1])) continue
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const borde = Math.max(Math.abs(x), Math.abs(y))
          set(cx + x, cy + y, borde === 1 ? 0 : 1)
        }
      }
    }
  }

  // Informacion de version, en dos bloques de 3x6 junto a los ojos.
  if (v >= 7) {
    const info = infoVersion(v)
    for (let i = 0; i < 18; i++) {
      const bit = (info >>> i) & 1
      const a = Math.floor(i / 3)
      const b = (i % 3) + size - 11
      set(a, b, bit)
      set(b, a, bit)
    }
  }

  return m
}

/**
 * Coloca los codewords recorriendo la matriz en columnas de dos, de abajo a
 * arriba y de derecha a izquierda, saltando lo que ya esta ocupado.
 */
function colocar(m, datos, size) {
  let bit = 0
  let subiendo = true

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col-- // la columna de sincronismo no cuenta
    for (let i = 0; i < size; i++) {
      const y = subiendo ? size - 1 - i : i
      for (const x of [col, col - 1]) {
        if (m[y][x] !== LIBRE) continue
        const valor = bit < datos.length * 8 ? (datos[bit >> 3] >> (7 - (bit & 7))) & 1 : 0
        m[y][x] = valor | DATO
        bit++
      }
    }
    subiendo = !subiendo
  }
}

const MASCARAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** Aplica una mascara sobre los modulos de datos y escribe el formato. */
function aplicar(base, size, mascara) {
  const m = base.map((fila) => Uint8Array.from(fila))
  const fn = MASCARAS[mascara]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (base[y][x] >= DATO) m[y][x] = (m[y][x] & 1) ^ (fn(x, y) ? 1 : 0)
    }
  }

  const info = infoFormato(mascara)
  for (let i = 0; i < 15; i++) {
    const bit = (info >>> i) & 1
    // Copia 1: alrededor del ojo de arriba a la izquierda, saltando el
    // sincronismo. Copia 2: repartida entre los otros dos ojos.
    if (i < 6) m[i][8] = bit
    else if (i === 6) m[7][8] = bit
    else if (i === 7) m[8][8] = bit
    else if (i === 8) m[8][7] = bit
    else m[8][14 - i] = bit

    if (i < 8) m[8][size - 1 - i] = bit
    else m[size - 15 + i][8] = bit
  }
  m[size - 8][8] = 1

  return m
}

/** Penalizacion de la norma: cuanto peor se lee una mascara, mas alta sale. */
function penalizacion(m, size) {
  let total = 0

  // N1: rachas de cinco o mas del mismo color, en filas y columnas.
  for (let i = 0; i < size; i++) {
    for (const leer of [(k) => m[i][k], (k) => m[k][i]]) {
      let racha = 1
      for (let k = 1; k < size; k++) {
        if (leer(k) === leer(k - 1)) racha++
        else {
          if (racha >= 5) total += racha - 2
          racha = 1
        }
      }
      if (racha >= 5) total += racha - 2
    }
  }

  // N2: bloques de 2x2 del mismo color.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y][x]
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) total += 3
    }
  }

  // N3: el patron 1:1:3:1:1 con cuatro blancos a un lado, que es justo lo que
  // busca el lector para encontrar los ojos.
  const patron = [1, 0, 1, 1, 1, 0, 1]
  const casa = (leer, k, seq) => seq.every((v, j) => leer(k + j) === v)
  for (let i = 0; i < size; i++) {
    for (const leer of [(k) => (k >= 0 && k < size ? m[i][k] : null), (k) => (k >= 0 && k < size ? m[k][i] : null)]) {
      for (let k = 0; k <= size - 7; k++) {
        if (!casa(leer, k, patron)) continue
        const antes = [k - 4, k - 3, k - 2, k - 1].every((j) => leer(j) === 0 || leer(j) === null)
        const despues = [k + 7, k + 8, k + 9, k + 10].every((j) => leer(j) === 0 || leer(j) === null)
        if (antes || despues) total += 40
      }
    }
  }

  // N4: desequilibrio entre negro y blanco.
  let negros = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) negros += m[y][x]
  const porcentaje = (negros * 100) / (size * size)
  total += Math.floor(Math.abs(porcentaje - 50) / 5) * 10

  return total
}

/**
 * Matriz de un texto: `true` es modulo negro.
 *
 * @param {string} texto
 * @returns {{size: number, version: number, mascara: number, modules: boolean[][]}}
 */
function encode(texto) {
  const bytes = Buffer.from(String(texto), 'utf8')

  let v = 0
  for (let i = 1; i <= 10; i++) {
    if (bytes.length <= capacidadBytes(i)) {
      v = i
      break
    }
  }
  if (!v) throw new Error(`El texto no cabe en un QR de version 10 (${bytes.length} bytes, maximo ${capacidadBytes(10)})`)

  const size = v * 4 + 17
  const base = patrones(v)
  colocar(base, codewords(bitstream(bytes, v), v), size)

  // Las ocho mascaras se prueban enteras y gana la de menos penalizacion: es lo
  // que dice la norma y es barato, son matrices de 60x60 como mucho.
  let mejor = null
  for (let mascara = 0; mascara < 8; mascara++) {
    const m = aplicar(base, size, mascara)
    const p = penalizacion(m, size)
    if (!mejor || p < mejor.p) mejor = { p, m, mascara }
  }

  return {
    size,
    version: v,
    mascara: mejor.mascara,
    modules: mejor.m.map((fila) => Array.from(fila, (v2) => v2 === 1)),
  }
}

/**
 * El mismo codigo como SVG, listo para pintar o imprimir.
 *
 * @param {string} texto
 * @param {object} [opts]
 * @param {number} [opts.escala]  Pixeles por modulo (por defecto 8).
 * @param {number} [opts.margen]  Modulos de zona tranquila; la norma pide 4.
 */
function toSvg(texto, opts = {}) {
  const { size, modules } = encode(texto)
  const escala = Number(opts.escala) || 8
  const margen = opts.margen === undefined ? 4 : Number(opts.margen)
  const lado = (size + margen * 2) * escala

  // Un rectangulo por racha horizontal en vez de uno por modulo: el SVG baja a
  // un tercio y el navegador no pinta 3000 nodos.
  const rects = []
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (!modules[y][x]) { x++; continue }
      let fin = x
      while (fin + 1 < size && modules[y][fin + 1]) fin++
      rects.push(
        `<rect x="${(x + margen) * escala}" y="${(y + margen) * escala}" ` +
          `width="${(fin - x + 1) * escala}" height="${escala}"/>`
      )
      x = fin + 1
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Codigo QR">` +
    `<rect width="${lado}" height="${lado}" fill="#fff"/>` +
    `<g fill="#000">${rects.join('')}</g>` +
    `</svg>`
  )
}

module.exports = { encode, toSvg, capacidadBytes }
