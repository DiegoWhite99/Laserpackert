package com.divergency.laserenviar

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Path
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
    private lateinit var textVersion: TextView
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
        textVersion = findViewById(R.id.textVersion)
        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager

        // Version bien visible a proposito: cuando algo "no se ve arreglado"
        // despues de instalar un APK nuevo, la causa mas comun es que quedo
        // la version vieja instalada (o se reabrio un .apk viejo repetido en
        // Descargas). Con esto se confirma de un vistazo cual build corre,
        // sin tener que adivinar.
        val info = packageManager.getPackageInfo(packageName, 0)
        @Suppress("DEPRECATION")
        textVersion.text = "v${info.versionName} (${info.versionCode})"

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
     * Ajusta el alto del recuadro de vista previa al aspecto real del bitmap
     * generado, calculado sobre el ancho que de verdad tiene el recuadro en
     * pantalla en ese momento -- no un valor en dp adivinado por XML, que se
     * queda corto o sobra segun la plantilla (una placa ancha y baja no es lo
     * mismo que una vertical) y segun el tamano/orientacion de la tablet.
     */
    private fun mostrarVistaPrevia(bitmap: Bitmap) {
        imagenVistaPrevia.setImageBitmap(bitmap)
        imagenVistaPrevia.post {
            val anchoPx = imagenVistaPrevia.width
            if (anchoPx <= 0 || bitmap.width <= 0) return@post
            val relacion = bitmap.height.toFloat() / bitmap.width.toFloat()
            val densidad = resources.displayMetrics.density
            val altoDeseado = (anchoPx * relacion).toInt()
                .coerceIn((70 * densidad).toInt(), (360 * densidad).toInt())
            val params = imagenVistaPrevia.layoutParams
            if (params.height != altoDeseado) {
                params.height = altoDeseado
                imagenVistaPrevia.layoutParams = params
            }
        }
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

        mostrarVistaPrevia(dibujarVistaPrevia(plantilla, nombre))

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

    /**
     * Convierte un "d" de SVG (M/L/C/Q/Z absolutos, que es lo unico que usa
     * Design Space en las rutas que exporta) a un android.graphics.Path,
     * dejando las coordenadas TAL CUAL vienen -- sin restar min-x/min-y
     * todavia, eso se hace en dibujarVistaPrevia() porque hace falta ese
     * bbox propio de la ruta para el offset (ver mas abajo).
     */
    private fun parsearPathSvg(d: String): Path {
        val tokens = Regex("[A-Za-z]|-?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?").findAll(d).map { it.value }.toList()
        val path = Path()
        var i = 0
        var cmd = ' '
        var startX = 0f
        var startY = 0f
        fun num(): Float { val v = tokens[i].toFloat(); i++; return v }
        while (i < tokens.size) {
            val tok = tokens[i]
            if (tok.length == 1 && tok[0].isLetter()) {
                cmd = tok[0]
                i++
            }
            when (cmd.uppercaseChar()) {
                'M' -> {
                    val x = num(); val y = num()
                    path.moveTo(x, y)
                    startX = x; startY = y
                    cmd = 'L'
                }
                'L' -> {
                    val x = num(); val y = num()
                    path.lineTo(x, y)
                }
                'C' -> {
                    val x1 = num(); val y1 = num(); val x2 = num(); val y2 = num(); val x = num(); val y = num()
                    path.cubicTo(x1, y1, x2, y2, x, y)
                }
                'Q' -> {
                    val x1 = num(); val y1 = num(); val x = num(); val y = num()
                    path.quadTo(x1, y1, x, y)
                }
                'Z' -> {
                    path.close()
                    path.moveTo(startX, startY)
                }
                else -> i++
            }
        }
        return path
    }

    /**
     * bbox propio de la ruta (en unidades nativas del path, antes de
     * escalar) -- Design Space guarda left/top/scaleX/scaleY relativos a
     * ESTE bbox, no al origen (0,0) del SVG completo: cada letra del logo
     * tiene sus propias coordenadas dentro del rango 0..3299 del SVG
     * original, y sin restar este offset las letras salen regadas con
     * huecos enormes entre ellas (comprobado a mano en Python contra la
     * miniatura real antes de escribir esto).
     */
    private fun bboxNativo(path: Path): RectF {
        val r = RectF()
        path.computeBounds(r, true)
        return r
    }

    /**
     * Solo para la vista previa dentro de nuestra propia app: logo + nombre
     * con la misma geometria del .lp2 (el .lp2 real que se manda no pasa
     * por aqui, usa los datos de LogoPaths.kt/Templates.kt tal cual).
     */
    private fun dibujarVistaPrevia(plantilla: TemplateSpec, nombre: String): Bitmap {
        val geo = layout(plantilla, nombre)
        val paint = TextPaint().apply {
            isAntiAlias = true
            color = Color.BLACK
            textSize = 200f
            typeface = if (plantilla.text.fontStyle == "italic") {
                Typeface.create(Typeface.SANS_SERIF, Typeface.ITALIC)
            } else {
                Typeface.SANS_SERIF
            }
        }

        val origenXMm = geo.logoLeft - MARGEN_MM
        val origenYMm = geo.logoTop - MARGEN_MM
        val anchoPx = ((geo.widthMm + MARGEN_MM * 2) * PX_POR_MM).toInt().coerceAtLeast(1)
        val altoPx = ((geo.heightMm + MARGEN_MM * 2) * PX_POR_MM).toInt().coerceAtLeast(1)

        val bitmap = Bitmap.createBitmap(anchoPx, altoPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val logoPaint = android.graphics.Paint().apply {
            isAntiAlias = true
            color = Color.BLACK
            style = android.graphics.Paint.Style.FILL
        }
        for (spec in plantilla.logoPaths) {
            val nativo = parsearPathSvg(spec.path)
            val bbox = bboxNativo(nativo)
            val dstLeftPx = ((spec.left - bbox.left * spec.scaleX - origenXMm) * PX_POR_MM).toFloat()
            val dstTopPx = ((spec.top - bbox.top * spec.scaleY - origenYMm) * PX_POR_MM).toFloat()
            canvas.save()
            canvas.translate(dstLeftPx, dstTopPx)
            canvas.scale((spec.scaleX * PX_POR_MM).toFloat(), (spec.scaleY * PX_POR_MM).toFloat())
            canvas.drawPath(nativo, logoPaint)
            canvas.restore()
        }

        val fm = paint.fontMetrics
        val medidoAnchoPx = paint.measureText(nombre)
        val medidoAltoPx = fm.descent - fm.ascent
        val objetivoAnchoPx = (geo.textMmWidth * PX_POR_MM).toFloat()
        val objetivoAltoPx = (geo.textMmHeight * PX_POR_MM).toFloat()
        val escalaX = if (medidoAnchoPx > 0f) objetivoAnchoPx / medidoAnchoPx else 1f
        val escalaY = if (medidoAltoPx > 0f) objetivoAltoPx / medidoAltoPx else 1f

        val dstTextLeft = ((geo.textLeft - origenXMm) * PX_POR_MM).toFloat()
        val dstTextTop = ((plantilla.text.top - origenYMm) * PX_POR_MM).toFloat()

        canvas.save()
        canvas.translate(dstTextLeft, dstTextTop)
        canvas.scale(escalaX, escalaY)
        canvas.drawText(nombre, 0f, -fm.ascent, paint)
        canvas.restore()

        return bitmap
    }
}
