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

/** Una pieza vectorial del logo (mtype 10004 en Design Space): un <path> de un SVG pegado directo en la app oficial. */
data class PathSpec(
    val path: String,
    val left: Double, val top: Double,
    val width: Double, val height: Double,
    val scaleX: Double, val scaleY: Double,
    val printPower: Int, val printDepth: Int,
)

data class TextSpec(
    val top: Double, val scaleX: Double, val scaleY: Double, val objectHeight: Double,
    val fontSize: Double, val fontFamily: String, val fontStyle: String,
    val printPower: Int, val printDepth: Int,
    // Times New Roman: metrica exacta (TIMES_WIDTHS). Arial/AgencyFB: estimacion por ancho medio (charRatio).
    val usaMetricaTimes: Boolean, val charRatio: Double = 0.0,
)

data class LayerOverride(val dpi: Double? = null, val px: Double? = null, val des: String? = null, val fanLevel: Int? = null, val pump: Int? = null)

data class TemplateSpec(
    val id: String, val label: String,
    val logoPaths: List<PathSpec>, val text: TextSpec,
    val enLinea: Boolean, // false = nombre debajo (centrado); true = nombre a la derecha del logo
    val gapMm: Double = 0.0, // espacio extra entre el borde del logo y el nombre (enLinea)
    val materialId: String, val materialKey: String, val materialName: String,
    val airAssist: Boolean,
    // El nombre vuelve a ser un objeto de texto real (mtype 10001, ver
    // Lp2Builder.kt), asi que cae en layerFill igual que las rutas del
    // logo (mtype 10004) -- por eso el override es de layerFill, no de
    // layerPicture (que ya no usa ningun objeto).
    val layerFillOverride: LayerOverride? = null,
)

data class Layout(
    val logoLeft: Double, val logoTop: Double,
    val logoMmWidth: Double, val logoMmHeight: Double,
    val objectWidth: Double, val textMmWidth: Double, val textMmHeight: Double,
    val textLeft: Double, val widthMm: Double, val heightMm: Double,
)

fun measureText(text: String, spec: TextSpec): Double =
    if (spec.usaMetricaTimes) measureTimesWidth(text, spec.fontSize) else text.length * spec.fontSize * spec.charRatio

/** Igual que layout() en templates.js: bounding box + posicion del nombre. */
fun layout(template: TemplateSpec, name: String): Layout {
    val logoLeft = template.logoPaths.minOf { it.left }
    val logoTop = template.logoPaths.minOf { it.top }
    val logoRight = template.logoPaths.maxOf { it.left + it.width * it.scaleX }
    val logoBottom = template.logoPaths.maxOf { it.top + it.height * it.scaleY }
    val logoMmWidth = logoRight - logoLeft
    val logoMmHeight = logoBottom - logoTop

    val text = template.text
    val objectWidth = measureText(name, text)
    val textMmWidth = objectWidth * text.scaleX
    val textMmHeight = text.objectHeight * text.scaleY

    val textLeft = if (template.enLinea) {
        logoRight + template.gapMm
    } else {
        logoLeft + logoMmWidth / 2 - textMmWidth / 2
    }

    val minX = min(logoLeft, textLeft)
    val maxX = max(logoRight, textLeft + textMmWidth)
    val minY = min(logoTop, text.top)
    val maxY = max(logoBottom, text.top + textMmHeight)

    return Layout(logoLeft, logoTop, logoMmWidth, logoMmHeight, objectWidth, textMmWidth, textMmHeight, textLeft, maxX - minX, maxY - minY)
}

// Solo queda "Formato Andicom" a proposito: la app se dedico al evento
// Andicom y se quitaron Esfero/Placa del selector para no confundir en el
// puesto.
//
// Geometria portada tal cual de "ANDICOM_V2.lp2" (guardado por el usuario
// directo en Design Space, localizado por su nombre unico en
// D:\Divergency\laserPeckerAuto\ANDICOM_V2.lp2). Cambio de fondo: el logo
// paso de imagen PNG a vector real -- el usuario pego "Logo negativo.svg"
// en Design Space y la app lo partio en 14 rutas (mtype 10004), portadas
// tal cual en LogoPaths.kt. El nombre paso de Times New Roman a Arial
// (ArialMT), que si existe en Android (a diferencia de Times New Roman),
// asi que vuelve a ser un objeto de texto real en vez de una imagen
// rasterizada. Verificado antes de aplicar: 20 caracteres x 12pt x
// charRatio (110.73046875/(20*12)) reproduce el ancho natural que trae el
// objeto de texto guardado para "Alberto Castelblanco".
val PLANTILLAS = listOf(
    TemplateSpec(
        id = "formato-andicom", label = "Formato Andicom",
        logoPaths = LOGO_ANDICOM_PATHS,
        text = TextSpec(
            top = 50.817418240684475,
            scaleX = 0.3243230327632283, scaleY = 0.27211668336229905,
            objectHeight = 13.56, fontSize = 12.0, fontFamily = "ArialMT", fontStyle = "",
            printPower = 80, printDepth = 80,
            usaMetricaTimes = false, charRatio = 110.73046875 / (20 * 12),
        ),
        enLinea = true,
        gapMm = 2.2035930212324786,
        materialId = "stainless_steel_0_10", materialKey = "stainless_steel", materialName = "Acero inoxidable",
        airAssist = false,
        layerFillOverride = LayerOverride(dpi = 846.66666, px = 1.0, des = "4K"),
    ),
)
