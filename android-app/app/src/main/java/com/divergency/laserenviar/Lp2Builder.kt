package com.divergency.laserenviar

import android.content.Context
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
 * (ZIP STORED con preview.png + res/ + .lpproject) y mismos nombres de
 * campo -- verificados contra el manifiesto/strings de la app oficial de
 * Android (com.hingin.lp1.hiprint), que declara "laserOptions",
 * "layerFill", "layerPicture", "file_id", "swVersion", "hwVersion" tal cual.
 *
 * El logo va como rutas vectoriales (mtype 10004, ver LogoPaths.kt) y el
 * nombre como texto real (mtype 10001) en Arial -- ninguno de los dos
 * necesita imagenes embebidas, asi que res/ queda vacio.
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

private fun pathObjectJson(spec: PathSpec, index: Int): JSONObject = JSONObject().apply {
    put("id", randomObjectId())
    put("mtype", 10004)
    put("uuid", UUID.randomUUID().toString())
    put("icon", "dotted")
    put("name", "layout $index")
    put("angle", 0)
    put("left", spec.left)
    put("top", spec.top)
    put("width", spec.width)
    put("height", spec.height)
    put("scaleX", spec.scaleX)
    put("scaleY", spec.scaleY)
    put("printPower", spec.printPower)
    put("printDepth", spec.printDepth)
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
    put("path", spec.path)
}

/** Construye el .lp2 (logo fijo + nombre) para una plantilla dada. */
fun buildBadgeLp2(context: Context, template: TemplateSpec, name: String): ByteArray {
    val geo = layout(template, name)
    val fileId = randomHex(16)
    val now = System.currentTimeMillis()

    val logoObjects = template.logoPaths.mapIndexed { i, spec -> pathObjectJson(spec, i + 1) }

    val nameObject = JSONObject().apply {
        put("id", randomObjectId())
        put("mtype", 10001)
        put("uuid", UUID.randomUUID().toString())
        put("icon", "tool-text")
        put("name", "text 1")
        put("angle", 0)
        put("left", geo.textLeft)
        put("top", template.text.top)
        put("width", geo.objectWidth)
        put("height", template.text.objectHeight)
        put("scaleX", template.text.scaleX)
        put("scaleY", template.text.scaleY)
        put("printPower", template.text.printPower)
        put("printDepth", template.text.printDepth)
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
        put("curvature", 0)
        put("text", name)
        put("textAlign", "left")
        put("fontSize", template.text.fontSize)
        put("lineHeight", 1.1)
        put("charSpacing", 0)
        put("fontFamily", template.text.fontFamily)
        put("fontWeight", "normal")
        put("fontStyle", template.text.fontStyle)
        put("underline", false)
        put("linethrough", false)
        put("orientation", 0)
        put("textColor", "#000000")
    }

    val dataArray = JSONArray().apply {
        put(nameObject)
        for (o in logoObjects) put(o)
    }

    val overrides = mapOf(
        "layerFill" to LayerPatch(
            printPower = template.text.printPower, printDepth = template.text.printDepth,
            materialId = template.materialId, materialKey = template.materialKey, materialName = template.materialName,
            dpi = template.layerFillOverride?.dpi, px = template.layerFillOverride?.px, des = template.layerFillOverride?.des,
            fanLevel = template.layerFillOverride?.fanLevel, pump = template.layerFillOverride?.pump,
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

    // La miniatura de la galeria sigue siendo el logo en PNG (no el vector):
    // es solo cosmetico -- ver la limitacion ya documentada en el README
    // ("la miniatura muestra solo el logo, sin el nombre").
    val logoPreview = context.assets.open("logo_original.png").use { it.readBytes() }

    return createStoredZip(
        listOf(
            ZipEntrySpec("preview.png", logoPreview),
            ZipEntrySpec("res/", ByteArray(0), isDir = true),
            ZipEntrySpec(".lpproject", lpproject.toString(2).toByteArray(Charsets.UTF_8)),
        )
    )
}
