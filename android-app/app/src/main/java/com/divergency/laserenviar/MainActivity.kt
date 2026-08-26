package com.divergency.laserenviar

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.BitmapFactory
import android.os.Bundle
import android.text.TextPaint
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Geometría de cada plantilla, sacada tal cual de src/templates.js (mm, medidos
 * sobre proyectos reales de Design Space). Aquí solo se usa para dibujar una
 * imagen razonable: el ajuste fino de verdad lo hace la app oficial de
 * LaserPecker al recibirla.
 */
data class Plantilla(
    val id: String,
    val etiqueta: String,
    val logoLeftMm: Float,
    val logoTopMm: Float,
    val logoWMm: Float,
    val logoHMm: Float,
    val textTopMm: Float,
    val textHeightMm: Float,
    val enLinea: Boolean, // true = nombre al lado del logo; false = nombre debajo
    val cursiva: Boolean,
)

private val PLANTILLAS = listOf(
    Plantilla(
        id = "esfero",
        etiqueta = "Esfero",
        logoLeftMm = 61.8746f, logoTopMm = 46.1021f,
        logoWMm = 300f * 0.039531683651796996f, logoHMm = 119f * 0.03917534998334469f,
        textTopMm = 50.76393f, textHeightMm = 13.56f * 0.19616519174041344f,
        enLinea = false, cursiva = false,
    ),
    Plantilla(
        id = "esfero-linea",
        etiqueta = "Esfero en línea",
        logoLeftMm = 40.76492f, logoTopMm = 48.97254f,
        logoWMm = 300f * 0.052937593428903654f, logoHMm = 119f * 0.052460420560889454f,
        textTopMm = 50.76393f, textHeightMm = 13.56f * 0.19616519174041344f,
        enLinea = true, cursiva = false,
    ),
    Plantilla(
        id = "placa",
        etiqueta = "Placa",
        logoLeftMm = 27.09266f, logoTopMm = 32.89677f,
        logoWMm = 300f * 0.13906264472739224f, logoHMm = 119f * 0.1378091513832468f,
        textTopMm = 49.29606f, textHeightMm = 13.56f * 0.7459956442207459f,
        enLinea = false, cursiva = true,
    ),
)

// Paquetes conocidos de la app oficial en Google Play. Si ninguno está
// instalado con ese id exacto, se cae al selector de "Compartir" normal.
private val PAQUETES_LASERPECKER = listOf(
    "com.hingin.lp1.hiprint",
    "com.hingin.l1.hiprint",
)

private const val PX_POR_MM = 40f
private const val MARGEN_MM = 3f

class MainActivity : AppCompatActivity() {

    private lateinit var editNombres: EditText
    private lateinit var spinnerPlantilla: Spinner
    private lateinit var imagenVistaPrevia: ImageView
    private lateinit var textEstado: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        editNombres = findViewById(R.id.editNombres)
        spinnerPlantilla = findViewById(R.id.spinnerPlantilla)
        imagenVistaPrevia = findViewById(R.id.imagenVistaPrevia)
        textEstado = findViewById(R.id.textEstado)

        spinnerPlantilla.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            PLANTILLAS.map { it.etiqueta },
        )

        findViewById<Button>(R.id.botonGenerar).setOnClickListener { generarYEnviar() }
    }

    private fun generarYEnviar() {
        val nombres = editNombres.text.toString()
            .split("\n")
            .map { it.trim().replace(Regex("\\s+"), " ") }
            .filter { it.isNotEmpty() }
            .distinctBy { it.lowercase() }

        if (nombres.isEmpty()) {
            textEstado.text = "Escribe al menos un nombre."
            return
        }

        val plantilla = PLANTILLAS[spinnerPlantilla.selectedItemPosition]
        val carpeta = File(cacheDir, "disenos").apply { mkdirs() }
        // Limpia lo generado en llamadas anteriores para no acumular archivos.
        carpeta.listFiles()?.forEach { it.delete() }

        val uris = nombres.mapIndexedNotNull { i, nombre ->
            try {
                val bitmap = dibujarPlaca(plantilla, nombre)
                if (i == 0) imagenVistaPrevia.setImageBitmap(bitmap)
                val archivo = File(carpeta, "placa-$i.png")
                FileOutputStream(archivo).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                FileProvider.getUriForFile(this, "$packageName.fileprovider", archivo)
            } catch (e: Exception) {
                null
            }
        }

        if (uris.isEmpty()) {
            textEstado.text = "No se pudo generar ninguna placa."
            return
        }

        val intent = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uris[0])
            }
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "image/png"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
            }
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

        val paqueteDirecto = PAQUETES_LASERPECKER.firstOrNull { pkg ->
            Intent(intent).setPackage(pkg).resolveActivity(packageManager) != null
        }

        if (paqueteDirecto != null) {
            startActivity(Intent(intent).setPackage(paqueteDirecto))
            textEstado.text = "${uris.size} placa(s) enviada(s) a LaserPecker."
        } else if (intent.resolveActivity(packageManager) != null) {
            startActivity(Intent.createChooser(intent, "Enviar diseño a LaserPecker"))
            textEstado.text = "Elige la app de LaserPecker en la lista para continuar."
        } else {
            textEstado.text = "No se encontró ninguna app instalada que reciba imágenes."
            Toast.makeText(this, "¿Está instalada la app de LaserPecker?", Toast.LENGTH_LONG).show()
        }
    }

    /** Logo + nombre en la misma disposición que la plantilla del puente de escritorio. */
    private fun dibujarPlaca(plantilla: Plantilla, nombre: String): Bitmap {
        val paint = TextPaint().apply {
            isAntiAlias = true
            color = Color.BLACK
            textSize = plantilla.textHeightMm * PX_POR_MM
            typeface = if (plantilla.cursiva) {
                Typeface.create("sans-serif-condensed", Typeface.ITALIC)
            } else {
                Typeface.SERIF
            }
        }

        val textWidthMm = paint.measureText(nombre) / PX_POR_MM
        val textLeftMm = if (plantilla.enLinea) {
            plantilla.logoLeftMm + plantilla.logoWMm
        } else {
            plantilla.logoLeftMm + plantilla.logoWMm / 2f - textWidthMm / 2f
        }

        val minX = min(plantilla.logoLeftMm, textLeftMm)
        val maxX = max(plantilla.logoLeftMm + plantilla.logoWMm, textLeftMm + textWidthMm)
        val minY = min(plantilla.logoTopMm, plantilla.textTopMm)
        val maxY = max(plantilla.logoTopMm + plantilla.logoHMm, plantilla.textTopMm + plantilla.textHeightMm)

        val origenXMm = minX - MARGEN_MM
        val origenYMm = minY - MARGEN_MM
        val anchoPx = (((maxX - minX) + MARGEN_MM * 2) * PX_POR_MM).toInt().coerceAtLeast(1)
        val altoPx = (((maxY - minY) + MARGEN_MM * 2) * PX_POR_MM).toInt().coerceAtLeast(1)

        val bitmap = Bitmap.createBitmap(anchoPx, altoPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val logo = BitmapFactory.decodeResource(resources, R.drawable.logo_divergency)
        val dstLeft = (plantilla.logoLeftMm - origenXMm) * PX_POR_MM
        val dstTop = (plantilla.logoTopMm - origenYMm) * PX_POR_MM
        val dst = RectF(dstLeft, dstTop, dstLeft + plantilla.logoWMm * PX_POR_MM, dstTop + plantilla.logoHMm * PX_POR_MM)
        canvas.drawBitmap(logo, null, dst, null)

        val textX = (textLeftMm - origenXMm) * PX_POR_MM
        val textTopPx = (plantilla.textTopMm - origenYMm) * PX_POR_MM
        val baseline = textTopPx - paint.ascent()
        canvas.drawText(nombre, textX, baseline, paint)

        return bitmap
    }
}
