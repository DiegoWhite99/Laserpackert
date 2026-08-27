package com.divergency.laserenviar

import java.text.Normalizer
import kotlin.math.max
import kotlin.math.min

/**
 * Geometria y metricas de fuente, portadas campo a campo de src/templates.js
 * del puente de escritorio. Los numeros salen por ingenieria inversa de
 * proyectos reales de Design Space y no se tocan sin volver a medir alli.
 */

const val TIMES_UNITS_PER_EM = 2048

val TIMES_WIDTHS: Map<Char, Int> = buildMap {
    for (c in '0'..'9') put(c, 1024)
    put('A', 1479); put('B', 1366); put('C', 1366); put('D', 1479); put('E', 1251); put('F', 1139)
    put('G', 1479); put('H', 1479); put('I', 682); put('J', 797); put('K', 1479); put('L', 1251)
    put('M', 1821); put('N', 1479); put('O', 1479); put('P', 1139); put('Q', 1479); put('R', 1366)
    put('S', 1139); put('T', 1251); put('U', 1479); put('V', 1479); put('W', 1933); put('X', 1479)
    put('Y', 1479); put('Z', 1251)
    put('a', 909); put('b', 1024); put('c', 909); put('d', 1024); put('e', 909); put('f', 682)
    put('g', 1024); put('h', 1024); put('i', 569); put('j', 569); put('k', 1024); put('l', 569)
    put('m', 1593); put('n', 1024); put('o', 1024); put('p', 1024); put('q', 1024); put('r', 682)
    put('s', 797); put('t', 569); put('u', 1024); put('v', 1024); put('w', 1479); put('x', 1024)
    put('y', 1024); put('z', 909)
    put(' ', 512); put('!', 682); put('"', 836); put('#', 1024); put('$', 1024); put('%', 1706)
    put('&', 1593); put('\'', 369); put('(', 682); put(')', 682); put('*', 1024); put('+', 1155)
    put(',', 512); put('-', 682); put('.', 512); put('/', 569); put(':', 569); put(';', 569)
    put('<', 1155); put('=', 1155); put('>', 1155); put('?', 909); put('@', 1886)
    put('[', 682); put('\\', 569); put(']', 682); put('^', 961); put('_', 1024); put('`', 682)
    put('{', 983); put('|', 410); put('}', 983); put('~', 1108)
    put('á', 909); put('é', 909); put('í', 569); put('ó', 1024); put('ú', 1024); put('ü', 1024); put('ñ', 1024)
    put('Á', 1479); put('É', 1251); put('Í', 682); put('Ó', 1479); put('Ú', 1479); put('Ü', 1479); put('Ñ', 1479)
    put('à', 909); put('è', 909); put('ì', 569); put('ò', 1024); put('ù', 1024)
    put('â', 909); put('ê', 909); put('î', 569); put('ô', 1024); put('û', 1024)
    put('ä', 909); put('ë', 909); put('ï', 569); put('ö', 1024); put('ç', 909); put('Ç', 1366)
    put('¿', 909); put('¡', 682); put('º', 635); put('ª', 565)
}

/** Ancho de "name" en unidades de fuente Times New Roman, igual que measureText() en templates.js. */
fun measureTimesWidth(text: String, fontSize: Double): Double {
    val porDefecto = TIMES_WIDTHS['n'] ?: (TIMES_UNITS_PER_EM / 2)
    var total = 0
    for (ch in text) {
        total += TIMES_WIDTHS[ch] ?: run {
            val base = Normalizer.normalize(ch.toString(), Normalizer.Form.NFD).firstOrNull()
            base?.let { TIMES_WIDTHS[it] } ?: porDefecto
        }
    }
    return (total.toDouble() / TIMES_UNITS_PER_EM) * fontSize
}

data class LogoSpec(
    val pxWidth: Double, val pxHeight: Double,
    val left: Double, val top: Double,
    val scaleX: Double, val scaleY: Double,
    val printPower: Int, val printDepth: Int,
)

data class TextSpec(
    val top: Double, val scaleX: Double, val scaleY: Double, val objectHeight: Double,
    val fontSize: Double, val fontStyle: String,
    // Times New Roman (esfero/esfero-linea): metrica exacta. AgencyFB (placa): estimacion por ancho medio.
    val usaMetricaTimes: Boolean, val charRatio: Double = 0.0,
)

data class LayerOverride(val dpi: Double? = null, val px: Double? = null, val des: String? = null, val fanLevel: Int? = null, val pump: Int? = null)

data class TemplateSpec(
    val id: String, val label: String,
    val logo: LogoSpec, val text: TextSpec,
    val enLinea: Boolean, // false = nombre debajo (centrado); true = nombre a la derecha del logo
    val materialId: String, val materialKey: String, val materialName: String,
    val airAssist: Boolean,
    // El nombre se manda como imagen (ver Lp2Builder.kt), asi que cae en la
    // misma capa que el logo (layerPicture): ya no hay objeto de texto que
    // use layerFill, por eso no hay override para esa capa.
    val layerPictureOverride: LayerOverride? = null,
)

data class Layout(
    val logoMmWidth: Double, val logoMmHeight: Double,
    val objectWidth: Double, val textMmWidth: Double, val textMmHeight: Double,
    val textLeft: Double, val widthMm: Double, val heightMm: Double,
)

fun measureText(text: String, spec: TextSpec): Double =
    if (spec.usaMetricaTimes) measureTimesWidth(text, spec.fontSize) else text.length * spec.fontSize * spec.charRatio

/** Igual que layout() en templates.js: bounding box + posicion del nombre. */
fun layout(template: TemplateSpec, name: String): Layout {
    val logo = template.logo
    val text = template.text
    val logoMmWidth = logo.pxWidth * logo.scaleX
    val logoMmHeight = logo.pxHeight * logo.scaleY

    val objectWidth = measureText(name, text)
    val textMmWidth = objectWidth * text.scaleX
    val textMmHeight = text.objectHeight * text.scaleY

    val textLeft = if (template.enLinea) {
        logo.left + logoMmWidth
    } else {
        logo.left + logoMmWidth / 2 - textMmWidth / 2
    }

    val minX = min(logo.left, textLeft)
    val maxX = max(logo.left + logoMmWidth, textLeft + textMmWidth)
    val minY = min(logo.top, text.top)
    val maxY = max(logo.top + logoMmHeight, text.top + textMmHeight)

    return Layout(logoMmWidth, logoMmHeight, objectWidth, textMmWidth, textMmHeight, textLeft, maxX - minX, maxY - minY)
}

// Solo queda "Formato Andicom" a proposito: la app se dedico al evento
// Andicom y se quitaron Esfero/Placa del selector para no confundir en el
// puesto. El logo va 2mm mas grande que el proyecto original en total (a
// pedido, en dos pasos de 1mm), manteniendo la proporcion 300x119 y el mismo
// punto de anclaje (left/top no se tocan, solo crece hacia la
// derecha/abajo). El nombre baja 1mm respecto al proyecto original.
val PLANTILLAS = listOf(
    TemplateSpec(
        id = "formato-andicom", label = "Formato Andicom",
        logo = LogoSpec(300.0, 119.0, 6.491587538347616, 34.80828710516282, 0.05507830755479201, 0.0556715361345589, 100, 77),
        text = TextSpec(37.04038410378957, 0.269208144493339, 0.2477021211141291, 13.56, 12.0, "", usaMetricaTimes = true),
        enLinea = true,
        materialId = "stainless_steel_0_10", materialKey = "stainless_steel", materialName = "Acero inoxidable",
        airAssist = false,
    ),
)
