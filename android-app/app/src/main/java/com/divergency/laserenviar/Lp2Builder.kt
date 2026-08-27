package com.divergency.laserenviar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.text.TextPaint
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.random.Random

/**
 * Constructor de proyectos .lp2 para LaserPecker Design Space, portado de
 * src/lp2.js + src/badge.js del puente de escritorio. Mismo contenedor
 * (ZIP STORED con preview.png + res/<uuid>.png + .lpproject) y mismos
 * nombres de campo -- verificados contra el manifiesto/strings de la app
 * oficial de Android (com.hingin.lp1.hiprint), que declara "laserOptions",
 * "layerFill", "layerPicture", "file_id", "swVersion", "hwVersion" tal cual.
 */

private data class DefaultLayer(
    val layerId: String, val dpi: Double, val px: Double, val des: String,
    val materialId: String, val materialKey: String, val materialName: String,
    val printDepth: Int, val printPower: Int,
    val printSpeed: Int? = null, val fanLevel: Int? = null, val pump: Int? = null,
)

private val DEFAULT_LAYERS = listOf(
    DefaultLayer("layerFill", 254.0, 4.0, "1K", "paper_jam_0_10", "paper_jam", "Cartulina", 26, 27, printSpeed = 0, fanLevel = 2, pump = 2),
    DefaultLayer("layerPicture", 846.66666, 1.0, "4K", "paper_jam_0_10", "paper_jam", "Cartulina", 5, 14, printSpeed = 0, fanLevel = 2, pump = 2),
    DefaultLayer("layerLine", 254.0, 4.0, "1K", "basswood_planks_0_10", "basswood_planks", "Tabla de tilo", 40, 55),
    DefaultLayer("layerCut", 254.0, 4.0, "1K", "basswood_planks_0_10", "basswood_planks", "Tabla de tilo", 89, 93),
    DefaultLayer("layerMetalCut", 254.0, 4.0, "1K", "basswood_planks_0_10", "basswood_planks", "Tabla de tilo", 40, 55),
)

data class LayerPatch(
    val printPower: Int? = null, val printDepth: Int? = null,
    val materialId: String? = null, val materialKey: String? = null, val materialName: String? = null,
    val dpi: Double? = null, val px: Double? = null, val des: String? = null,
    val fanLevel: Int? = null, val pump: Int? = null,
)

private fun buildLaserOptions(overrides: Map<String, LayerPatch>, airAssist: Boolean): JSONArray {
    val arr = JSONArray()
    for (layer in DEFAULT_LAYERS) {
        val patch = overrides[layer.layerId]
        val obj = JSONObject()
        obj.put("version", 1)
        obj.put("diameter", 20)
        obj.put("lightSource", 0)
        obj.put("precision", 1)
        obj.put("layerId", layer.layerId)
        obj.put("dpi", patch?.dpi ?: layer.dpi)
        obj.put("px", patch?.px ?: layer.px)
        obj.put("des", patch?.des ?: layer.des)
        obj.put("materialId", patch?.materialId ?: layer.materialId)
        obj.put("materialKey", patch?.materialKey ?: layer.materialKey)
        obj.put("materialName", patch?.materialName ?: layer.materialName)
        obj.put("printCount", 1)
        obj.put("printDepth", patch?.printDepth ?: layer.printDepth)
        obj.put("printPower", patch?.printPower ?: layer.printPower)
        if (layer.printSpeed != null) obj.put("printSpeed", layer.printSpeed)

        val fanLevel: Int?
        val pump: Int?
        if (patch?.fanLevel != null) {
            fanLevel = patch.fanLevel
            pump = patch.pump ?: 0
        } else if (airAssist && layer.fanLevel != null) {
            fanLevel = layer.fanLevel
            pump = layer.pump
        } else {
            fanLevel = null
            pump = null
        }
        if (fanLevel != null) {
            obj.put("fanLevel", fanLevel)
            obj.put("pump", pump)
        }

        if (layer.layerId == "layerFill" || layer.layerId == "layerPicture") {
            obj.put("embossHeight", 0.01)
            obj.put("embossPreviewCount", 1)
        }
        obj.put("devicePower", 10)
        arr.put(obj)
    }
    return arr
}

// Resolucion a la que se rasteriza el nombre, en pixeles por mm (~610 dpi,
// mas fino que el logo original de 300x119px para que el trazo no se vea
// escalonado al grabar). Times New Roman y AgencyFB-Reg (las fuentes de los
// proyectos originales) no existen en Android: Design Space las sustituye Y
// REMIDE el texto al abrir el .lp2, lo que descuadra el nombre contra el
// logo en la tablet aunque el archivo tenga la geometria correcta -- se
// comprobo en un dispositivo real (informaba 6.43mm de alto para una caja
// guardada en 5.82mm). Por eso el nombre se manda ya rasterizado con la
// fuente empaquetada (Tinos, metricamente igual a Times New Roman), igual
// que el logo: una imagen no se puede "remedir" con otra fuente.
private const val RENDER_PX_POR_MM = 24f

private fun renderizarNombre(context: Context, template: TemplateSpec, nombre: String, geo: Layout): Bitmap {
    val archivoFuente = if (template.text.fontStyle == "italic") "fonts/Tinos-Italic.ttf" else "fonts/Tinos-Regular.ttf"
    val paint = TextPaint().apply {
        isAntiAlias = true
        color = Color.BLACK
        typeface = Typeface.createFromAsset(context.assets, archivoFuente)
        textSize = 200f
    }
    val fm = paint.fontMetrics
    val medidoAnchoPx = paint.measureText(nombre)
    val medidoAltoPx = fm.descent - fm.ascent

    val anchoPx = (geo.textMmWidth * RENDER_PX_POR_MM).toInt().coerceAtLeast(1)
    val altoPx = (geo.textMmHeight * RENDER_PX_POR_MM).toInt().coerceAtLeast(1)
    val escalaX = if (medidoAnchoPx > 0f) anchoPx / medidoAnchoPx else 1f
    val escalaY = if (medidoAltoPx > 0f) altoPx / medidoAltoPx else 1f

    val bitmap = Bitmap.createBitmap(anchoPx, altoPx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.save()
    canvas.scale(escalaX, escalaY)
    canvas.drawText(nombre, 0f, -fm.ascent, paint)
    canvas.restore()
    return bitmap
}

private fun pngBytes(bitmap: Bitmap): ByteArray =
    ByteArrayOutputStream().use { out ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        out.toByteArray()
    }

private fun randomObjectId(): Long = Random.nextLong(1, 0xffffffffL)

private fun randomHex(bytes: Int): String {
    val b = ByteArray(bytes)
    Random.Default.nextBytes(b)
    return b.joinToString("") { "%02x".format(it) }
}

private data class ZipEntrySpec(val name: String, val data: ByteArray, val isDir: Boolean = false)

private fun createStoredZip(entries: List<ZipEntrySpec>): ByteArray {
    val baos = ByteArrayOutputStream()
    ZipOutputStream(baos).use { zos ->
        for (e in entries) {
            val entry = ZipEntry(if (e.isDir && !e.name.endsWith("/")) e.name + "/" else e.name)
            entry.method = ZipEntry.STORED
            entry.size = e.data.size.toLong()
            entry.compressedSize = e.data.size.toLong()
            val crc = CRC32()
            crc.update(e.data)
            entry.crc = crc.value
            zos.putNextEntry(entry)
            if (e.data.isNotEmpty()) zos.write(e.data)
            zos.closeEntry()
        }
    }
    return baos.toByteArray()
}

/** Construye el .lp2 (logo fijo + nombre) para una plantilla dada. */
fun buildBadgeLp2(context: Context, template: TemplateSpec, name: String): ByteArray {
    val geo = layout(template, name)
    val fileId = randomHex(16)
    val now = System.currentTimeMillis()

    val logoOriginal = context.assets.open("logo_original.png").use { it.readBytes() }
    val logoSrc = context.assets.open("logo_src.png").use { it.readBytes() }

    val originalUri = "res/${UUID.randomUUID()}.png"
    val srcUri = "res/${UUID.randomUUID()}.png"

    val logoObject = JSONObject().apply {
        put("id", randomObjectId())
        put("mtype", 10010)
        put("uuid", UUID.randomUUID().toString())
        put("icon", "tool-image")
        put("name", "image 1")
        put("angle", 0)
        put("left", template.logo.left)
        put("top", template.logo.top)
        put("width", template.logo.pxWidth)
        put("height", template.logo.pxHeight)
        put("scaleX", template.logo.scaleX)
        put("scaleY", template.logo.scaleY)
        put("printPower", template.logo.printPower)
        put("printDepth", template.logo.printDepth)
        put("printCount", 1)
        put("printSpeed", 0)
        put("isCut", false)
        put("isMetalCut", false)
        put("flipX", false)
        put("flipY", false)
        put("skewX", 0)
        put("skewY", 0)
        put("paintStyle", 0)
        put("visible", true)
        put("strokeWidth", 0)
        put("groupId", "")
        put("groupName", "")
        put("imageFilter", 5)
        put("contrast", 0)
        put("brightness", 0)
        put("blackThreshold", 132)
        put("sealThreshold", 123)
        put("printsThreshold", 210)
        put("inverse", false)
        put("imageOriginalUri", originalUri)
        put("srcUri", srcUri)
    }

    val nombreBitmap = renderizarNombre(context, template, name, geo)
    val nombreBytes = pngBytes(nombreBitmap)
    val nombreOriginalUri = "res/${UUID.randomUUID()}.png"
    val nombreSrcUri = "res/${UUID.randomUUID()}.png"

    // Se manda como imagen, no como texto editable: ver el comentario de
    // renderizarNombre(). Al ser imagen queda en la misma capa que el logo
    // (layerPicture no distingue objetos), asi que usa su misma potencia --
    // decision tomada con el usuario a proposito de perder el ajuste fino
    // independiente que tenia el texto (antes 80/80 contra el 100/77 del
    // logo).
    val nameObject = JSONObject().apply {
        put("id", randomObjectId())
        put("mtype", 10010)
        put("uuid", UUID.randomUUID().toString())
        put("icon", "tool-image")
        put("name", "image 2")
        put("angle", 0)
        put("left", geo.textLeft)
        put("top", template.text.top)
        put("width", nombreBitmap.width.toDouble())
        put("height", nombreBitmap.height.toDouble())
        put("scaleX", geo.textMmWidth / nombreBitmap.width)
        put("scaleY", geo.textMmHeight / nombreBitmap.height)
        put("printPower", template.logo.printPower)
        put("printDepth", template.logo.printDepth)
        put("printCount", 1)
        put("printSpeed", 0)
        put("isCut", false)
        put("isMetalCut", false)
        put("flipX", false)
        put("flipY", false)
        put("skewX", 0)
        put("skewY", 0)
        put("paintStyle", 0)
        put("visible", true)
        put("strokeWidth", 0)
        put("groupId", "")
        put("groupName", "")
        put("imageFilter", 5)
        put("contrast", 0)
        put("brightness", 0)
        put("blackThreshold", 132)
        put("sealThreshold", 123)
        put("printsThreshold", 210)
        put("inverse", false)
        put("imageOriginalUri", nombreOriginalUri)
        put("srcUri", nombreSrcUri)
    }

    val dataArray = JSONArray().apply { put(nameObject); put(logoObject) }

    val overrides = mapOf(
        "layerPicture" to LayerPatch(
            printPower = template.logo.printPower, printDepth = template.logo.printDepth,
            materialId = template.materialId, materialKey = template.materialKey, materialName = template.materialName,
            dpi = template.layerPictureOverride?.dpi, px = template.layerPictureOverride?.px, des = template.layerPictureOverride?.des,
            fanLevel = template.layerPictureOverride?.fanLevel, pump = template.layerPictureOverride?.pump,
        ),
    )
    val laserOptions = buildLaserOptions(overrides, template.airAssist)

    val lpproject = JSONObject().apply {
        put("width", geo.widthMm)
        put("height", geo.heightMm)
        put("file_id", fileId)
        put("file_name", name)
        put("data", dataArray.toString())
        put("swVersion", 10300)
        put("hwVersion", 12288)
        put("create_time", now)
        put("update_time", now)
        put("version", 2)
        put("laserOptions", laserOptions.toString())
    }

    return createStoredZip(
        listOf(
            ZipEntrySpec("preview.png", logoOriginal),
            ZipEntrySpec("res/", ByteArray(0), isDir = true),
            ZipEntrySpec(originalUri, logoOriginal),
            ZipEntrySpec(srcUri, logoSrc),
            ZipEntrySpec(nombreOriginalUri, nombreBytes),
            ZipEntrySpec(nombreSrcUri, nombreBytes),
            ZipEntrySpec(".lpproject", lpproject.toString(2).toByteArray(Charsets.UTF_8)),
        )
    )
}
