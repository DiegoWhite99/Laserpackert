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
    val fontSize: Double, val fontFamily: String, val fontStyle: String, val lineHeight: Double,
    val printPower: Int, val printDepth: Int,
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
    val layerFillOverride: LayerOverride? = null,
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

val PLANTILLAS = listOf(
    TemplateSpec(
        id = "esfero", label = "Esfero",
        logo = LogoSpec(300.0, 119.0, 61.8746168029476, 46.1020669130106, 0.0395316836517970, 0.0391753499833447, 65, 30),
        text = TextSpec(50.76393356102865, 0.2366024321796071, 0.19616519174041344, 13.56, 12.0, "Times New Roman", "", 1.1, 73, 15, usaMetricaTimes = true),
        enLinea = false,
        materialId = "aluminum_0_10", materialKey = "aluminum", materialName = "Óxido de aluminio",
        airAssist = false,
    ),
    TemplateSpec(
        id = "esfero-linea", label = "Formato Andicom",
        logo = LogoSpec(300.0, 119.0, 40.764920620455825, 48.97253853765574, 0.052937593428903654, 0.052460420560889454, 5, 20),
        text = TextSpec(50.76393356102865, 0.2366024321796071, 0.19616519174041344, 13.56, 12.0, "Times New Roman", "", 1.1, 20, 14, usaMetricaTimes = true),
        enLinea = true,
        materialId = "acrylic_0_10", materialKey = "acrylic", materialName = "Acrílico",
        airAssist = false,
        layerFillOverride = LayerOverride(dpi = 846.66666, px = 1.0, des = "4K"),
        layerPictureOverride = LayerOverride(fanLevel = 0, pump = 0),
    ),
    TemplateSpec(
        id = "placa", label = "Placa",
        logo = LogoSpec(300.0, 119.0, 27.092661128138637, 32.89677475564266, 0.13906264472739224, 0.1378091513832468, 14, 5),
        text = TextSpec(49.29606377024903, 0.5969161786971131, 0.7459956442207459, 13.56, 12.0, "AgencyFB-Reg", "italic", 1.1, 27, 26, usaMetricaTimes = false, charRatio = 60.1640625 / (15 * 12)),
        enLinea = false,
        materialId = "paper_jam_0_10", materialKey = "paper_jam", materialName = "Cartulina",
        airAssist = true,
    ),
)
