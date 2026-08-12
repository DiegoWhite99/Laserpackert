'use strict'

// Constructor de grabados Divergency AI: logo fijo + nombre centrado debajo.
//
// La geometria no vive aqui: sale de src/templates.js, que la copia al
// decimal de proyectos reales aprobados en pantalla. Este modulo solo
// materializa el .lp2.

const crypto = require('node:crypto')
const { createZip } = require('./zip')
const { buildLaserOptions } = require('./lp2')
const { getTemplate, layout, DEFAULT_TEMPLATE } = require('./templates')
const resources = require('./resources')

// Los dos bitmaps del objeto imagen: el original y el ya procesado por el
// filtro de la app. Se cargan una vez al arrancar; ambas plantillas usan el
// mismo logo y solo cambian de escala.
const LOGO_ORIGINAL = resources.readOrThrow('assets/divergency-logo-original.png')
const LOGO_SRC = resources.readOrThrow('assets/divergency-logo-src.png')

function objectId() {
  return crypto.randomInt(1, 0xffffffff)
}

/**
 * Construye un .lp2 con el logo fijo y el nombre dado.
 *
 * @param {object} spec
 * @param {string} spec.name             Nombre a grabar
 * @param {string} [spec.template]       'esfero' (por defecto) o 'placa'
 * @param {string} [spec.projectName]    Nombre en la galeria (por defecto, el nombre)
 * @param {object} [spec.laser]          { power, depth, textPower, textDepth, materialName, ... }
 * @returns {{fileId, buffer, previewDataUri, widthMm, heightMm, createTime, template}}
 */
function buildBadge(spec) {
  const name = String(spec.name || '').trim()
  if (!name) throw new Error('El nombre no puede estar vacio')

  const template = getTemplate(spec.template ?? DEFAULT_TEMPLATE)
  const { logo, text } = template
  const geo = layout(template, name)

  const fileId = crypto.randomBytes(16).toString('hex')
  const now = Date.now()
  const laser = spec.laser || {}

  const logoPower = laser.power ?? logo.printPower
  const logoDepth = laser.depth ?? logo.printDepth
  const namePower = laser.textPower ?? text.printPower
  const nameDepth = laser.textDepth ?? text.printDepth

  const originalUri = `res/${crypto.randomUUID()}.png`
  const srcUri = `res/${crypto.randomUUID()}.png`

  const logoObject = {
    id: objectId(),
    mtype: 10010,
    uuid: crypto.randomUUID(),
    icon: 'tool-image',
    name: 'image 1',
    angle: 0,
    left: logo.left,
    top: logo.top,
    width: logo.pxWidth,
    height: logo.pxHeight,
    scaleX: logo.scaleX,
    scaleY: logo.scaleY,
    printPower: logoPower,
    printDepth: logoDepth,
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
    imageOriginalUri: originalUri,
    srcUri: srcUri,
  }

  const nameObject = {
    id: objectId(),
    mtype: 10001,
    uuid: crypto.randomUUID(),
    icon: 'tool-text',
    name: 'text 1',
    angle: 0,
    left: geo.textLeft,
    top: text.top,
    width: geo.objectWidth,
    height: text.objectHeight,
    scaleX: text.scaleX,
    scaleY: text.scaleY,
    printPower: namePower,
    printDepth: nameDepth,
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
    text: name,
    textAlign: 'left',
    fontSize: text.fontSize,
    lineHeight: text.lineHeight,
    charSpacing: 0,
    fontFamily: laser.fontFamily ?? text.fontFamily,
    fontWeight: 'normal',
    fontStyle: text.fontStyle,
    underline: false,
    linethrough: false,
    orientation: 0,
    textColor: '#000000',
  }

  const capas = template.layers || {}

  const material = {
    materialName: laser.materialName ?? template.laserMaterial.materialName,
    materialKey: laser.materialKey ?? template.laserMaterial.materialKey,
    materialId: laser.materialId ?? template.laserMaterial.materialId,
  }

  const lpproject = {
    width: geo.widthMm,
    height: geo.heightMm,
    file_id: fileId,
    file_name: spec.projectName || name,
    data: JSON.stringify([nameObject, logoObject]),
    swVersion: 10300,
    hwVersion: 12288,
    create_time: now,
    update_time: now,
    version: 2,
    laserOptions: JSON.stringify(
      buildLaserOptions(
        {
          // Los ajustes de capa de la plantilla (resolucion, aire) van primero:
          // lo que llegue en la peticion tiene que poder pisarlos. Y el dpi solo
          // se pone si viene de verdad, porque un `dpi: undefined` borraria el
          // de la plantilla en lugar de dejarlo pasar.
          layerPicture: {
            ...capas.layerPicture,
            printPower: logoPower,
            printDepth: logoDepth,
            ...material,
            ...(laser.dpi !== undefined ? { dpi: laser.dpi } : {}),
          },
          layerFill: { ...capas.layerFill, printPower: namePower, printDepth: nameDepth, ...material },
        },
        { airAssist: template.airAssist }
      )
    ),
  }

  const buffer = createZip([
    { name: 'preview.png', data: LOGO_ORIGINAL },
    { name: 'res/', dir: true },
    { name: originalUri, data: LOGO_ORIGINAL },
    { name: srcUri, data: LOGO_SRC },
    { name: '.lpproject', data: Buffer.from(JSON.stringify(lpproject, null, 2), 'utf8') },
  ])

  return {
    fileId,
    buffer,
    previewDataUri: `data:image/png;base64,${LOGO_ORIGINAL.toString('base64')}`,
    widthMm: lpproject.width,
    heightMm: lpproject.height,
    createTime: now,
    template: template.id,
  }
}

module.exports = { buildBadge }
