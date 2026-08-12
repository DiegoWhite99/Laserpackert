'use strict'

// Constructor de proyectos .lp2 para LaserPecker Design Space.
//
// Estructura del contenedor (ZIP stored):
//   preview.png          miniatura que la app muestra en la galeria
//   res/<uuid>.png       bitmaps referenciados por los objetos
//   .lpproject           descriptor JSON
//
// En el .lpproject, "data" y "laserOptions" son cadenas con JSON
// embebido, no objetos. Respetarlo es imprescindible: la app hace
// JSON.parse sobre esos campos al abrir el archivo.

const crypto = require('node:crypto')
const { createZip } = require('./zip')
const { imageSize } = require('./imgsize')

const MTYPE_TEXT = 10001
const MTYPE_IMAGE = 10010

// Capas del dispositivo. Los valores por defecto salen de un proyecto
// real generado por la app (LP4, madera/cartulina).
const DEFAULT_LAYERS = [
  { layerId: 'layerFill', dpi: 254, px: 4, des: '1K', materialId: 'paper_jam_0_10', materialKey: 'paper_jam', materialName: 'Cartulina', printDepth: 26, printPower: 27, printSpeed: 0, fanLevel: 2, pump: 2 },
  { layerId: 'layerPicture', dpi: 846.66666, px: 1, des: '4K', materialId: 'paper_jam_0_10', materialKey: 'paper_jam', materialName: 'Cartulina', printDepth: 5, printPower: 14, printSpeed: 0, fanLevel: 2, pump: 2 },
  { layerId: 'layerLine', dpi: 254, px: 4, des: '1K', materialId: 'basswood_planks_0_10', materialKey: 'basswood_planks', materialName: 'Tabla de tilo', printDepth: 40, printPower: 55 },
  { layerId: 'layerCut', dpi: 254, px: 4, des: '1K', materialId: 'basswood_planks_0_10', materialKey: 'basswood_planks', materialName: 'Tabla de tilo', printDepth: 89, printPower: 93 },
  { layerId: 'layerMetalCut', dpi: 254, px: 4, des: '1K', materialId: 'basswood_planks_0_10', materialKey: 'basswood_planks', materialName: 'Tabla de tilo', printDepth: 40, printPower: 55 },
]

/**
 * @param {object} overrides            Parches por layerId. Ademas de potencia,
 *                                      profundidad y material, una capa puede
 *                                      cambiar la resolucion (`dpi`/`px`/`des`,
 *                                      que van juntos) y el aire (`fanLevel` y
 *                                      `pump`, o `aire: false` para quitarlo de
 *                                      esa capa en concreto).
 * @param {object} [opts]
 * @param {boolean} [opts.airAssist]    Con false se omiten fanLevel/pump en las
 *                                      capas de grabado. El proyecto del esfero
 *                                      no los lleva y el de cartulina si.
 */
function buildLaserOptions(overrides = {}, opts = {}) {
  const airAssist = opts.airAssist !== false
  return DEFAULT_LAYERS.map((layer) => {
    const patch = overrides[layer.layerId] || {}

    // El aire no es un si/no para todo el proyecto: "formato Esfero" lo trae en
    // la capa del logo con valor 0 y no lo trae en la del texto. Un booleano
    // global no puede decir eso, asi que la capa manda si se pronuncia.
    const aire =
      patch.aire === false
        ? {}
        : patch.fanLevel !== undefined
          ? { fanLevel: patch.fanLevel, pump: patch.pump ?? 0 }
          : airAssist && layer.fanLevel !== undefined
            ? { fanLevel: layer.fanLevel, pump: layer.pump }
            : {}

    return {
      version: 1,
      diameter: 20,
      lightSource: 0,
      precision: 1,
      layerId: layer.layerId,
      // dpi, px y des describen la misma cosa (la resolucion) y la app los
      // escribe siempre a juego: 254/4/"1K" o 846.66666/1/"4K".
      dpi: patch.dpi ?? layer.dpi,
      px: patch.px ?? layer.px,
      des: patch.des ?? layer.des,
      materialId: patch.materialId ?? layer.materialId,
      materialKey: patch.materialKey ?? layer.materialKey,
      materialName: patch.materialName ?? layer.materialName,
      printCount: patch.printCount ?? 1,
      printDepth: patch.printDepth ?? layer.printDepth,
      printPower: patch.printPower ?? layer.printPower,
      // Las capas de linea y corte no llevan printSpeed en los proyectos
      // que genera la app; no se les inventa uno.
      ...(layer.printSpeed !== undefined ? { printSpeed: patch.printSpeed ?? layer.printSpeed } : {}),
      ...aire,
      ...(layer.layerId === 'layerFill' || layer.layerId === 'layerPicture'
        ? { embossHeight: 0.01, embossPreviewCount: 1 }
        : {}),
      devicePower: 10,
    }
  })
}

function objectId() {
  // La app usa enteros sin signo de 32 bits como id de objeto.
  return crypto.randomInt(1, 0xffffffff)
}

function imageObject({ name, pxWidth, pxHeight, mmWidth, mmHeight, left, top, resUri, power, depth }) {
  return {
    id: objectId(),
    mtype: MTYPE_IMAGE,
    uuid: crypto.randomUUID(),
    icon: 'tool-image',
    name,
    angle: 0,
    left,
    top,
    width: pxWidth,
    height: pxHeight,
    scaleX: mmWidth / pxWidth,
    scaleY: mmHeight / pxHeight,
    printPower: power,
    printDepth: depth,
    printCount: 1,
    printSpeed: 0,
    isCut: false,
    isMetalCut: false,
    flipX: false,
    flipY: false,
    skewX: 0,
    skewY: 0,
    paintStyle: 0,
    visible: true,
    strokeWidth: 0,
    groupId: '',
    groupName: '',
    imageFilter: 5,
    contrast: 0,
    brightness: 0,
    blackThreshold: 132,
    sealThreshold: 123,
    printsThreshold: 210,
    inverse: false,
    imageOriginalUri: resUri,
    srcUri: resUri,
  }
}

function textObject({ name, text, left, top, fontSize, fontFamily, power, depth }) {
  // width/height son metricas de fuente que la app recalcula al abrir;
  // se aproximan aqui solo para que el bounding box inicial sea sensato.
  const approxWidth = text.length * fontSize * 0.55
  const approxHeight = fontSize * 1.13
  return {
    id: objectId(),
    mtype: MTYPE_TEXT,
    uuid: crypto.randomUUID(),
    icon: 'tool-text',
    name,
    angle: 0,
    left,
    top,
    width: approxWidth,
    height: approxHeight,
    scaleX: 1,
    scaleY: 1,
    printPower: power,
    printDepth: depth,
    printCount: 1,
    printSpeed: 0,
    isCut: false,
    isMetalCut: false,
    flipX: false,
    flipY: false,
    skewX: 0,
    skewY: 0,
    paintStyle: 0,
    visible: true,
    strokeWidth: 0,
    groupId: '',
    groupName: '',
    curvature: 0,
    text,
    textAlign: 'left',
    fontSize,
    lineHeight: 1.1,
    charSpacing: 0,
    fontFamily,
    fontWeight: 'normal',
    fontStyle: 'normal',
    underline: false,
    linethrough: false,
    orientation: 0,
    textColor: '#000000',
  }
}

/**
 * Construye un .lp2 en memoria.
 *
 * @param {object} spec
 * @param {string} spec.name            Nombre visible del proyecto
 * @param {Buffer} [spec.image]         PNG o JPEG a grabar
 * @param {number} [spec.widthMm]       Ancho destino; si falta se deduce del alto o se usa 40
 * @param {number} [spec.heightMm]      Alto destino; si falta se conserva la proporcion
 * @param {number} [spec.left]          Posicion X en mm sobre el lienzo
 * @param {number} [spec.top]           Posicion Y en mm sobre el lienzo
 * @param {string} [spec.text]          Texto opcional bajo la imagen
 * @param {number} [spec.fontSize]
 * @param {string} [spec.fontFamily]
 * @param {object} [spec.laser]         { power, depth, dpi, materialName, ... }
 * @returns {{fileId: string, buffer: Buffer, previewDataUri: string, widthMm: number, heightMm: number}}
 */
function buildLp2(spec) {
  const fileId = crypto.randomBytes(16).toString('hex')
  const now = Date.now()
  const objects = []
  const entries = []
  const resFiles = []

  const laser = spec.laser || {}
  const imgPower = laser.power ?? 14
  const imgDepth = laser.depth ?? 5

  let left = spec.left ?? 10
  let top = spec.top ?? 10
  let contentWidth = 0
  let contentHeight = 0
  let previewSource = null

  if (spec.image) {
    const { width: pxWidth, height: pxHeight } = imageSize(spec.image)
    const aspect = pxHeight / pxWidth

    let mmWidth = spec.widthMm
    let mmHeight = spec.heightMm
    if (!mmWidth && !mmHeight) mmWidth = 40
    if (mmWidth && !mmHeight) mmHeight = mmWidth * aspect
    if (mmHeight && !mmWidth) mmWidth = mmHeight / aspect

    const resUri = `res/${crypto.randomUUID()}.png`
    resFiles.push({ name: resUri, data: spec.image })
    objects.push(
      imageObject({
        name: 'image 1',
        pxWidth,
        pxHeight,
        mmWidth,
        mmHeight,
        left,
        top,
        resUri,
        power: imgPower,
        depth: imgDepth,
      })
    )

    contentWidth = mmWidth
    contentHeight = mmHeight
    previewSource = spec.image
  }

  if (spec.text) {
    const fontSize = spec.fontSize ?? 12
    const textTop = spec.image ? top + contentHeight + 2 : top
    objects.push(
      textObject({
        name: 'text 1',
        text: spec.text,
        left,
        top: textTop,
        fontSize,
        fontFamily: spec.fontFamily ?? 'AgencyFB-Reg',
        power: laser.textPower ?? 27,
        depth: laser.textDepth ?? 26,
      })
    )
    // El texto suma al bounding box: aprox 0.353 mm por punto de fuente.
    const textMm = fontSize * 0.353 * 1.13
    contentHeight = spec.image ? contentHeight + 2 + textMm : textMm
    contentWidth = Math.max(contentWidth, spec.text.length * fontSize * 0.55 * 0.353)
  }

  if (!objects.length) throw new Error('El proyecto necesita al menos una imagen o un texto')

  // preview.png: sin rasterizador propio se reutiliza el bitmap de origen.
  // Es lo unico que la app usa para la tarjeta de la galeria; el lienzo
  // real se reconstruye siempre desde "data".
  const preview = previewSource ?? Buffer.alloc(0)

  const lpproject = {
    width: contentWidth,
    height: contentHeight,
    file_id: fileId,
    file_name: spec.name || 'Untitled',
    data: JSON.stringify(objects),
    swVersion: 10300,
    hwVersion: 12288,
    create_time: now,
    update_time: now,
    version: 2,
    laserOptions: JSON.stringify(
      buildLaserOptions({
        layerPicture: {
          printPower: imgPower,
          printDepth: imgDepth,
          dpi: laser.dpi,
          materialName: laser.materialName,
          materialKey: laser.materialKey,
          materialId: laser.materialId,
        },
        layerFill: {
          printPower: laser.textPower ?? 27,
          printDepth: laser.textDepth ?? 26,
          materialName: laser.materialName,
          materialKey: laser.materialKey,
          materialId: laser.materialId,
        },
      })
    ),
  }

  if (preview.length) entries.push({ name: 'preview.png', data: preview })
  entries.push({ name: 'res/', dir: true })
  for (const file of resFiles) entries.push(file)
  entries.push({ name: '.lpproject', data: Buffer.from(JSON.stringify(lpproject, null, 2), 'utf8') })

  return {
    fileId,
    buffer: createZip(entries),
    previewDataUri: preview.length ? `data:image/png;base64,${preview.toString('base64')}` : '',
    widthMm: contentWidth,
    heightMm: contentHeight,
    createTime: now,
  }
}

module.exports = { buildLp2, buildLaserOptions, MTYPE_TEXT, MTYPE_IMAGE }
