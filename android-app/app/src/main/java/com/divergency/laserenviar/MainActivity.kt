package com.divergency.laserenviar

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.RectF
import android.graphics.Typeface
import android.hardware.usb.UsbManager
import android.os.Build
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

// Mismo chip serie que detecta el puente de escritorio en machine.js: WCH
// CH340/CH9102, vendor id 0x1A86. Aca solo se enumera (sin abrir el
// dispositivo), asi que no hace falta pedir permiso USB en tiempo de
// ejecucion: es una pista visual, igual que alla, no la autoridad sobre si
// la laser esta realmente lista.
private const val VENDOR_ID_LASERPECKER = 0x1A86

// Paquetes conocidos de la app oficial en Google Play, y la actividad exacta
// que ya declara aceptar VIEW/SEND de un fichero de proyecto (confirmado
// inspeccionando su manifiesto): com.angcyo.laserpacker.open.CanvasOpenActivity.
private val PAQUETES_LASERPECKER = listOf(
    "com.hingin.lp1.hiprint",
    "com.hingin.l1.hiprint",
)
private const val ACTIVIDAD_ABRIR_PROYECTO = "com.angcyo.laserpacker.open.CanvasOpenActivity"

private const val PX_POR_MM = 40f
private const val MARGEN_MM = 3f

class MainActivity : AppCompatActivity() {

    private lateinit var editNombres: EditText
    private lateinit var spinnerPlantilla: Spinner
    private lateinit var imagenVistaPrevia: ImageView
    private lateinit var textEstado: TextView
    private lateinit var textEstadoCable: TextView
    private lateinit var usbManager: UsbManager

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            actualizarEstadoCable()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        editNombres = findViewById(R.id.editNombres)
        spinnerPlantilla = findViewById(R.id.spinnerPlantilla)
        imagenVistaPrevia = findViewById(R.id.imagenVistaPrevia)
        textEstado = findViewById(R.id.textEstado)
        textEstadoCable = findViewById(R.id.textEstadoCable)
        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager

        spinnerPlantilla.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            PLANTILLAS.map { it.label },
        )

        findViewById<Button>(R.id.botonGenerar).setOnClickListener { generarYEnviar() }
    }

    override fun onResume() {
        super.onResume()
        val filtro = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(usbReceiver, filtro, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(usbReceiver, filtro)
        }
        actualizarEstadoCable()
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(usbReceiver)
    }

    /**
     * Pista visual, no autoridad: igual que machine.js en el puente de
     * escritorio, esto solo enumera el USB por vendor id (0x1A86, chip WCH
     * de la laser) para avisar si falta el cable. Quien manda de verdad
     * sobre si la laser esta lista es Design Space, que la abre despues.
     */
    private fun actualizarEstadoCable() {
        val conectada = usbManager.deviceList.values.any { it.vendorId == VENDOR_ID_LASERPECKER }
        if (conectada) {
            textEstadoCable.text = "🟢 Laser conectada por cable"
            textEstadoCable.setBackgroundColor(Color.parseColor("#DFF5E1"))
            textEstadoCable.setTextColor(Color.parseColor("#1B7A34"))
        } else {
            textEstadoCable.text = "🔴 Conecta la tablet a la laser con el cable USB"
            textEstadoCable.setBackgroundColor(Color.parseColor("#FBE1E1"))
            textEstadoCable.setTextColor(Color.parseColor("#B3261E"))
        }
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
        val nombre = nombres.first()

        val bytes = try {
            buildBadgeLp2(this, plantilla, nombre)
        } catch (e: Exception) {
            textEstado.text = "No se pudo generar la placa: ${e.message}"
            return
        }

        imagenVistaPrevia.setImageBitmap(dibujarVistaPrevia(plantilla, nombre))

        val carpeta = File(cacheDir, "proyectos").apply { mkdirs() }
        carpeta.listFiles()?.forEach { it.delete() }
        val archivo = File(carpeta, "${slug(nombre)}.lp2")
        FileOutputStream(archivo).use { it.write(bytes) }
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", archivo)

        var enviado = false
        for (pkg in PAQUETES_LASERPECKER) {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/octet-stream")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                component = ComponentName(pkg, ACTIVIDAD_ABRIR_PROYECTO)
            }
            if (intent.resolveActivity(packageManager) != null) {
                startActivity(intent)
                enviado = true
                break
            }
        }

        if (!enviado) {
            for (pkg in PAQUETES_LASERPECKER) {
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/octet-stream")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    setPackage(pkg)
                }
                if (intent.resolveActivity(packageManager) != null) {
                    startActivity(intent)
                    enviado = true
                    break
                }
            }
        }

        if (!enviado) {
            val chooser = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/octet-stream")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            if (chooser.resolveActivity(packageManager) != null) {
                startActivity(Intent.createChooser(chooser, "Abrir proyecto en LaserPecker"))
                enviado = true
            }
        }

        if (!enviado) {
            textEstado.text = "No se encontró la app de LaserPecker instalada."
            Toast.makeText(this, "Instala LaserPecker Design Space en la tablet primero.", Toast.LENGTH_LONG).show()
            return
        }

        // Se envia de a uno: el proyecto que ya salio se quita de la lista, asi
        // que el siguiente toque manda el que sigue.
        val restantes = nombres.drop(1)
        editNombres.setText(restantes.joinToString("\n"))
        textEstado.text = if (restantes.isEmpty()) {
            "\"$nombre\" enviado a LaserPecker como proyecto."
        } else {
            "\"$nombre\" enviado. Quedan ${restantes.size}: pulsa de nuevo para el siguiente."
        }
    }

    private fun slug(s: String) = s.lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .ifEmpty { "placa" }

    /** Solo para la vista previa dentro de nuestra propia app: logo + nombre con la misma geometria del .lp2. */
    private fun dibujarVistaPrevia(plantilla: TemplateSpec, nombre: String): Bitmap {
        val geo = layout(plantilla, nombre)
        val paint = TextPaint().apply {
            isAntiAlias = true
            color = Color.BLACK
            textSize = (geo.textMmHeight * PX_POR_MM).toFloat()
            typeface = if (plantilla.text.fontStyle == "italic") {
                Typeface.create("sans-serif-condensed", Typeface.ITALIC)
            } else {
                Typeface.SERIF
            }
        }

        val minX = minOf(plantilla.logo.left, geo.textLeft)
        val minY = minOf(plantilla.logo.top, plantilla.text.top)
        val origenXMm = minX - MARGEN_MM
        val origenYMm = minY - MARGEN_MM
        val anchoPx = ((geo.widthMm + MARGEN_MM * 2) * PX_POR_MM).toInt().coerceAtLeast(1)
        val altoPx = ((geo.heightMm + MARGEN_MM * 2) * PX_POR_MM).toInt().coerceAtLeast(1)

        val bitmap = Bitmap.createBitmap(anchoPx, altoPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val logo = BitmapFactory.decodeStream(assets.open("logo_original.png"))
        val dstLeft = ((plantilla.logo.left - origenXMm) * PX_POR_MM).toFloat()
        val dstTop = ((plantilla.logo.top - origenYMm) * PX_POR_MM).toFloat()
        val dst = RectF(dstLeft, dstTop, dstLeft + (geo.logoMmWidth * PX_POR_MM).toFloat(), dstTop + (geo.logoMmHeight * PX_POR_MM).toFloat())
        canvas.drawBitmap(logo, null, dst, null)

        // Centrado vertical dentro de la caja del objeto (top..top+height), no
        // apoyado en el tope: Design Space centra el nombre contra el logo (se
        // comprobo a mano contra "Formato Andicom" que sus centros verticales
        // coinciden al milimetro), y anclar solo por ascent() ignora el
        // descendente y descuadra la vista previa contra eso.
        val textX = ((geo.textLeft - origenXMm) * PX_POR_MM).toFloat()
        val textBoxTopPx = ((plantilla.text.top - origenYMm) * PX_POR_MM).toFloat()
        val textBoxHeightPx = (geo.textMmHeight * PX_POR_MM).toFloat()
        val glyphHeightPx = paint.descent() - paint.ascent()
        val baseline = textBoxTopPx + (textBoxHeightPx - glyphHeightPx) / 2f - paint.ascent()
        canvas.drawText(nombre, textX, baseline, paint)

        return bitmap
    }
}
