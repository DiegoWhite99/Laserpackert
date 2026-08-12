# Divergency Grabadora Láser

Landing + servidor local que genera un proyecto `.lp2` de **LaserPecker Design Space** por cada nombre de una lista. El logo va fijo; solo cambia el nombre.

Los nombres se escriben a mano o los pone la propia gente: hay un **registro por
QR** para eventos, con su número de turno y una cola de la que salen las placas.

## Por qué hace falta un puente

Design Space **no expone ninguna API**. Levanta un servidor Express en el puerto `9898`, pero solo sirve su propio frontend: cualquier otra ruta devuelve 404. No hay nada a lo que mandarle un POST.

Este proyecto aporta el receptor que falta:

```
Landing  --POST /api/badges-->  puente :7788  -->  un <uuid>.lp2 por nombre
   (lista de nombres)                 |
                                      +-- CDP :9222 --> window.Project.StorageableAsync()
                                                              |
                                            Design Space las registra y las muestra

Grabar   --POST /api/badges (engrave)-->  abrir lienzo + "Vista previa"
            (una pieza)                            |
         <-- "comprueba la pieza" ------------------+
         --POST /api/engrave (confirm)-->  salir de la previa + "Grabado laser"
                                                   + aceptar el aviso de la app

Registro    QR --> movil --> puesto :7789  -->  cola.json  -->  lote de placas
   (en el evento)          (otro servidor,        (turno #45)
                            abierto a mano)
```

## Uso

Hay dos formas de arrancarlo, y hacen lo mismo:

```bash
npm start          # desde el codigo: node src/server.js
```

```
DivergencyGrabadoraLaser.exe   # un solo fichero, sin Node instalado
```

El `.exe` se construye con `Construir.bat` (ver [El ejecutable](#el-ejecutable)) y abre la landing solo.

Abre <http://127.0.0.1:7788>, escribe el nombre y pulsa **Generar y ver vista previa**.

Si el indicador dice que el modo en vivo está inactivo, pulsa **Activar modo en vivo** en la propia landing: cierra Design Space de forma ordenada y la reabre con el puerto de depuración. Es lo mismo que `.\launch-app.ps1`, sin salir del navegador. Marcando la casilla crea además un atajo en el Escritorio que ya abre la app así, y entonces deja de hacer falta.

Sin el modo en vivo las piezas se generan igual, pero no se puede grabar desde la landing y hay que reiniciar Design Space para verlas en la galería.

### El grabado va en dos pasos, a propósito

El láser no se dispara de una. Al pulsar **Generar y ver vista previa**:

1. Se crea el `.lp2` y se registra en la galería
2. Se abre en el lienzo y se comprueba que haya máquina conectada
3. Se pulsa **Vista previa**: la máquina recorre el contorno sobre la pieza sin quemar
4. La landing pregunta: *comprueba la vista previa sobre la pieza*

Con **Continuar y grabar** se sale de la vista previa, se pulsa *Grabado láser* y se acepta el aviso de verificación de Design Space — pero **solo si los parámetros que anuncia ese aviso coinciden con los de la pieza generada**. Si no coinciden, se cancela y se dice por qué: grabar con otra potencia estropea la pieza, y la propia app está enseñando los valores, así que comprobarlo es gratis.

Con **Cancelar** se sale de la vista previa y la pieza se queda generada en la galería.

`Modo ensayo` recorre todo el camino (abrir, comprobar máquina, localizar el botón) sin pulsar nada.

### Después de generar: ajustar y guardar como plantilla

Con la pieza ya creada aparecen dos cosas:

- **Realizar proyecto** — la abre en el lienzo de Design Space y trae la app al frente, para ajustar el diseño a mano. No toca la máquina.
- **¿Guardar este proyecto como plantilla?** — guarda los valores de potencia y profundidad que tienes puestos con un nombre, y aparece como una pestaña más. Se conserva en `plantillas.json` (configurable con `LP_TEMPLATES_FILE`).

Una plantilla propia es **una plantilla base más los ajustes de láser probados en la máquina**: la geometría, la fuente y el material salen de la base (`esfero` o `placa`), así que guardar ajustes no puede descolocar un diseño que ya salía bien. Las base no se pueden borrar; las propias se quitan con la ✕ de su pestaña.

## Registro por QR

En un evento no hay quien escriba los nombres a mano. Se abre el registro desde
la landing (**Lote de nombres → Registro por QR → Abrir el registro**), se enseña
o se imprime el código, y cada persona se apunta desde su teléfono con nombre,
celular y correo. Al enviar, la página le da **su número de turno** —"tu turno es
el #45"— que es con el que se le llama después.

De ahí sale el lote: la cola aparece en la propia landing con una casilla por
persona y **Generar las seleccionadas** hace una placa por turno. Lo generado se
marca en la cola con el id de su placa, así que nadie se queda sin la suya ni le
sale dos veces.

El número de turno **no es la posición en la lista**: es un contador que solo
sube. Si fuera la posición, al generar las primeras placas todo el mundo cambiaría
de número y quien tiene el 45 en la mano dejaría de ser el 45. Por eso mismo
vaciar la cola tampoco reinicia el contador.

Dos personas que se llamen igual son dos placas: por turnos **no** se descartan
repetidos, al revés que en la lista escrita a mano, donde un nombre repetido es un
error de dedo.

### Es otro servidor, y a propósito

El puente escucha solo en loopback porque escribe ficheros arbitrarios y dispara
un láser. El puesto de registro es un servidor aparte (`src/registro.js`) que
atiende exactamente dos rutas —el formulario y el alta— y no sabe hacer nada más:
no sirve ficheros por ruta, no toca Design Space y no llega a la máquina. Lo peor
que puede hacer alguien de la red es apuntarse muchas veces, y para eso hay un
límite de 15 altas cada 10 minutos por IP, 4 KB de cuerpo y 1000 en cola.

Se abre a mano y con confirmación, igual que el `--lan` de la landing de descarga:
compartir algo con la red es una decisión, no un valor por defecto. Al cerrarlo la
cola se conserva; solo deja de aceptar gente.

El código QR se dibuja aquí (`src/qr.js`, sin dependencias) porque en el sitio del
evento puede no haber internet, y pedirle la imagen a un servicio de fuera sería
un cuadro vacío justo con la gente delante. Está verificado módulo a módulo contra
una implementación ajena.

## Vaciar la galería

**Vaciar la galería de Design Space**, en la landing, manda a la papelera todas las
placas generadas y deja las plantillas. No hay ninguna marca en la base que
distinga unas de otras —la app numera sus proyectos igual que este puente—, así
que se distinguen por dónde vive el fichero:

| | Dónde | Qué se hace |
|---|---|---|
| Placa generada | dentro de `LP_PROJECT_DIR` | se borra |
| Formato / plantilla | fuera (Descargas, normalmente) | se conserva |
| Se llama `formato…`, `plantilla…`, `esfero…`, `placa…` | donde sea | se conserva |

Ante la duda se conserva: volver a generar una placa cuesta un minuto y recuperar
un formato original puede costar la tarde. La lista sale en pantalla antes de
borrar nada, con las placas marcadas y las plantillas desmarcadas, y se puede
cambiar a mano lo que haga falta.

Es la **papelera de la app**, no un borrado de verdad: se rellena `deleted_date`,
que es justo lo que hace Design Space, y desde la app se puede restaurar. Los
`.lp2` se quedan en disco salvo que se marque la casilla de borrarlos también —y
esos sí no vuelven.

### Conexión de la máquina

El indicador distingue tres cosas, sin adivinar ninguna:

| Estado | De dónde sale |
|---|---|
| **Conectada** · `LP2P-…` | La app no muestra su botón rojo *Conecta el dispositivo* y hay nombre de máquina en pantalla |
| **No conectada** | La app está mostrando ese botón rojo. La landing ofrece **Conectar la máquina**, que lo pulsa por ti |
| **No se puede saber** | Fuera del lienzo la app no pinta nada de esto. Se muestra la última conexión conocida y se confirma al abrir el diseño |

A eso se le suma una comprobación a nivel de sistema: la máquina se presenta como un USB-serie de WCH (`VID_1A86`, aquí un CH9102 en COM4), así que se sabe si está **enchufada y encendida** aunque la app no diga nada. Sirve para explicar un "no conectada"; no la sustituye, porque por Bluetooth no hay puerto serie que ver.

## El ejecutable

```
Construir.bat        # o: npm run build
```

Deja en `web\descargas\`: el `DivergencyGrabadoraLaser.exe` (~91 MB), su `.sha256.txt` y un `version.json` con tamaño, huella y fecha — que es lo que lee la landing de descarga para no tener esos datos escritos a mano.

Son las [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) de Node: se cocina un blob con el código y los recursos y se inyecta en una copia de `node.exe`. De los 91 MB, el código propio son 130 KB; el resto es el motor que lo ejecuta, y es justo lo que permite que en la otra máquina no haya que instalar nada.

| Paso | Qué pasa |
|---|---|
| 1 | `build/bundle.js` mete `src/` en un solo `.cjs` y escribe la config de SEA |
| 2 | `node --experimental-sea-config` cocina el blob |
| 3 | Se copia `node.exe` |
| 4 | `build/icono.ps1` saca el icono del logo y `resedit` pone icono y propiedades |
| 5 | `postject` inyecta el blob |
| 6 | Se **arranca el .exe de verdad** y se le piden la landing, el logo y una medida |
| 7 | Se publica con su huella |

El paso 6 no es decorativo: sin él se publicaría un ejecutable que nadie ha abierto. Y el 4 va antes del 5 porque `resedit` reescribe los recursos del PE, que es donde acaba viviendo el blob.

Hay un bundler propio de 40 líneas en vez de una dependencia porque SEA solo acepta **un** script y dentro del ejecutable `require('./algo')` no resuelve nada — solo funcionan los módulos nativos. Se reescriben los requires relativos y se deja el resto igual.

Se construye con el mismo Node que va dentro, así que hace falta **22.5 o más nuevo** (`node:sqlite`, que es lo que registra en la galería). El build lo comprueba antes de empezar.

Dos interruptores: `-SinMetadatos` (sin icono ni propiedades, para no depender de la red) y `-SaltarPrueba` (sin el paso 6, solo para depurar el propio build).

### Qué va dentro y qué se queda fuera

Embebidos en el blob: la landing (`public/`), los dos bitmaps del logo y `launch-app.ps1`. El `.ps1` se extrae a disco al usarlo, porque `powershell -File` necesita un fichero — y se extrae a `%LOCALAPPDATA%`, no a `%TEMP%`, que es escribible por cualquiera de la máquina y esto se ejecuta.

`src/resources.js` es el único módulo que sabe en cuál de los dos mundos está corriendo: pide los recursos a SEA o los lee del repo, y decide dónde se escribe. El resto del código no se entera. Correr `node src/server.js` sigue comportándose exactamente igual que antes.

Lo escribible **no** va al lado del ejecutable, que puede estar en Descargas o en Program Files: las plantillas propias del `.exe` y la cola del registro viven en `%LOCALAPPDATA%\PlacasDivergencyAI\` (`plantillas.json` y `cola.json`). Desinstalar es borrar el `.exe` y esa carpeta.

El ejecutable **no está firmado**, así que SmartScreen avisa la primera vez (*Más información* → *Ejecutar de todas formas*). Es lo que hay sin un certificado; la landing lo dice y publica la huella para poder comprobar el archivo.

## La landing de descarga

`web/` es un sitio estático: la página, el logo y la carpeta de descargas. El botón apunta a `descargas/DivergencyGrabadoraLaser.exe` con ruta relativa, así que funciona en cualquier hosting siempre que la carpeta viaje junta.

```bash
npm run landing              # http://127.0.0.1:8080
node web/serve.js --lan      # tambien desde la red local, para bajarlo en otro equipo
```

Salir de loopback se pide a mano (`--lan`): compartir un ejecutable con la red es una decisión, no un valor por defecto. El servidor es de solo lectura y no toca nada de fuera de `web/`; el puente de verdad —el que escribe ficheros y dispara el láser— es otro proceso y sigue escuchando solo en `127.0.0.1`.

Para publicarla en internet vale cualquier hosting estático. Con GitHub Pages hay un detalle: rechaza ficheros de más de 100 MB, y los 91,5 MB caben por poco margen — si el ejecutable crece, mejor subirlo como *release asset* y apuntar el botón ahí.

## Modo en vivo

Verificado de punta a punta contra Design Space 2.12.1 (Electron 31.7.7).

La app expone en su renderer su propia capa de datos:

```js
window.Project.StorageableAsync(row)      // alta / actualización
window.Project.StorageableListAsync(rows) // alta en lote
window.Project.FindByIdAsync(id) / FindByOne(...)
window.Project.DeleteByIdAsync(id) / DeleteByIdListAsync(ids)
window.Project.RestoreByIdAsync(id) / RestoreByIdListAsync(ids)
window.Project.ToPageListAsync(...)       // listado paginado
```

Registrar por ahí es mejor que escribir el SQLite a mano: es la app la que graba, con su misma capa de datos y su misma validación.

**La galería no se refresca sola.** La vista solo consulta al montarse, así que tras registrar hay que remontarla. `cdp.refreshGallery()` lo hace con un rebote de ruta (`#/dashboard` → `#/setting` → `#/dashboard`), que es mucho más suave que recargar el renderer.

> **Salvaguarda:** el rebote **solo** se ejecuta si el usuario está en la galería. Hacerlo mientras edita un diseño desmontaría el lienzo y le haría perder el trabajo sin guardar, así que en ese caso el puente no toca la ruta y lo dice en la respuesta.

Si el depurador no está accesible, el registro cae solo a escribir el SQLite directamente: las placas se crean igual y solo hará falta reiniciar para verlas. Nunca se pierde trabajo por no tener el modo en vivo.

## Las plantillas base

Cada una sale por ingeniería inversa de un proyecto que ya estaba hecho a mano en Design Space, y se conserva su geometría al decimal para que lo generado salga idéntico a lo que se aprobó en pantalla.

| | `esfero` | `esfero-linea` | `placa` |
|---|---|---|---|
| Origen | `divergency esfero.lp2` | `formato Esfero.lp2` | `d829c4b2…lp2` ("Viviana Jimenez") |
| Material | Óxido de aluminio | **Acrílico** | Cartulina |
| Disposición | nombre centrado **debajo** | nombre **al lado**, a la derecha | nombre centrado **debajo** |
| Logo | 11.86 × 4.66 mm en (61.875, 46.102) | 15.88 × 6.24 mm en (40.765, 48.973) | 41.72 × 16.40 mm en (27.093, 32.897) |
| Logo: potencia / profundidad | 65 / 30 | **5 / 20** | 14 / 5 |
| Nombre | 12 pt Times New Roman en Y 50.764 | 12 pt Times New Roman en Y 50.764 | 12 pt AgencyFB-Reg *itálica* en Y 49.296 |
| Nombre: potencia / profundidad | 73 / 15 | **20 / 14** | 27 / 26 |
| Resolución del texto | 1K (254 dpi) | **4K (846.67 dpi)** | 1K (254 dpi) |
| Aire | sin `fanLevel`/`pump` | solo en el logo, a **0** | `fanLevel`/`pump` a 2 |
| Alto total | 7.32 mm | 6.24 mm | 26.51 mm |

En `esfero-linea` el nombre **no** se centra: arranca exactamente donde acaba el logo (su `left` original coincide al decimal con `logo.left` + ancho del logo) y queda centrado en vertical con él, porque las dos alturas son fijas y no dependen del nombre.

Añadir otra plantilla base es una entrada más en `TEMPLATES` (`src/templates.js`). La landing no hay que tocarla: pinta las pestañas con lo que devuelve `/api/templates` y ella misma pasa a rejilla flexible a partir de la tercera.

### El ancho del nombre

Con Times New Roman el ancho **no se estima**: la tabla `TIMES_WIDTHS` son los avances reales de la fuente en unidades de 2048 por em, medidos con `canvas.measureText` en Chromium, que es el mismo camino por el que mide Design Space (Electron + fabric.js). Verificado contra los dos proyectos originales, al bit: "Jarvey" → `31.318359375` y "Diego Castelblanco" → `94.306640625`, exactamente lo que declaran sus objetos de texto.

Antes había ahí métricas AFM de Times Roman, que se parecen pero no son las de esta fuente: daban un error de milésimas. Para volver a medirlas (otra fuente, otra versión de la app):

```js
const c = document.createElement('canvas').getContext('2d')
c.font = '12px "Times New Roman"'
c.measureText('a').width * 2048 / 12   // -> unidades de fuente
```

`placa` usa AgencyFB-Reg, que no es una fuente del sistema y no se puede medir así: ahí sigue el ancho medio de glifo del original (`charRatio`), que es una estimación.

### El logo

Los bitmaps viven en `assets/`: `divergency-logo-original.png` (el original) y `divergency-logo-src.png` (el ya procesado por el filtro de la app). Para cambiar de logo, sustituye ambos por otro PNG de **300 × 119 px**; con otras dimensiones hay que ajustar las escalas de cada plantilla.

## API

### `POST /api/badges` — lote de placas

```jsonc
{
  "names": ["Viviana Jimenez", "Diego Castelblanco"],  // o un string con saltos de línea
  "power": 14, "depth": 5,            // capa del logo
  "textPower": 27, "textDepth": 26,   // capa del nombre
  "materialName": "Cartulina"
}
```

Normaliza espacios, ignora líneas vacías y **descarta duplicados** sin distinguir mayúsculas. Máximo 200 nombres por lote.

En vez de `names` se puede mandar `turnos: [12, 13, 14]` y los nombres salen de la
cola del registro. Ahí los repetidos **no** se descartan (dos personas distintas
pueden llamarse igual) y lo que se genere se marca en la cola con el id de su
placa; lo que falle sigue pendiente.

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:7788/api/badges -Method Post `
  -ContentType application/json `
  -Body (@{ names = @("Viviana Jimenez", "Diego Castelblanco") } | ConvertTo-Json -Compress)
```

```jsonc
{
  "ok": true, "createdCount": 2, "failedCount": 0,
  "duplicatesIgnored": [],
  "created": [
    { "name": "Viviana Jimenez", "id": "f3f3…", "path": "D:\\…\\f3f3….lp2",
      "widthMm": 41.72, "heightMm": 26.51, "galleryRegistered": true }
  ],
  "failed": []
}
```

Con `engrave: true` genera **una** pieza y lanza la vista previa (`preview: false` para grabar de una, sin ese paso). La respuesta trae `engrave.pendienteDeConfirmar: true` cuando toca confirmar.

### `POST /api/engrave` — grabar, paso 2

```jsonc
{ "id": "064f78…", "name": "Prueba", "confirm": true, "stopPreview": true }
```

`confirm: true` es **obligatorio** salvo en `dryRun`: este endpoint enciende el láser sobre una pieza real. Sale de la vista previa, pulsa *Grabado láser* y acepta el aviso de verificación de la app tras comprobar sus parámetros; si no cuadran devuelve `stage: "parametros"` sin grabar. `arranco: true` significa que el panel de trabajo apareció de verdad, no solo que se pulsó.

### `POST /api/stop`

Sale de la vista previa o detiene el trabajo en curso, según lo que haya montado la app.

### `POST /api/open`

```jsonc
{ "id": "c28e7efa…", "name": "Ajuste Uno" }
```

Abre la pieza en el lienzo y trae la ventana al frente (`alFrente: true` si lo consiguió). Es el *Realizar proyecto* de la landing.

### `GET/POST/DELETE /api/templates`

`POST { label, base, logoPower, logoDepth, textPower, textDepth }` guarda o actualiza una plantilla propia (`base` debe ser `esfero` o `placa`; las potencias van de 1 a 100). `DELETE { id }` la quita. Ambas devuelven la lista completa ya resuelta, igual que `GET`.

### `POST /api/device/connect`

Pulsa *Conecta el dispositivo* en la app. Necesita un diseño abierto en el lienzo, que es donde existe ese botón.

### `POST /api/live/enable`

Deja Design Space corriendo con el puerto de depuración. Requiere `confirm: true` porque cierra y reabre la app (`428` si falta); `shortcut: true` crea además el atajo de Escritorio. Si el modo ya está activo no toca nada y devuelve `estado: "ya-activo"`.

### `POST /api/design` — proyecto libre

Para una imagen cualquiera en vez del logo fijo: acepta `image` (PNG o JPEG en data URI o base64), `widthMm`, `heightMm`, `left`, `top`, `text`, `fontSize`, `power`, `depth`, `dpi`, `materialName`.

### `DELETE /api/projects` — vaciar la galería

```jsonc
{ "confirm": true, "todo": true }              // todas las placas generadas
{ "confirm": true, "ids": ["886b0be0…"] }      // solo estas
{ "confirm": true, "todo": true, "borrarArchivos": true }
```

`confirm: true` es obligatorio. Con `todo` **nunca** entran las plantillas; para
llevarse una hay que nombrarla en `ids`. Borra por la app (`DeleteByIdListAsync`)
si hay modo en vivo y escribiendo `deleted_date` si no, y comprueba contra la
propia app que hayan desaparecido en vez de fiarse de que la llamada no fallara.

### `GET/DELETE /api/queue` — la cola del registro

`GET` devuelve los pendientes (`?todo=1` incluye los ya generados) con su turno,
nombre, celular y correo. `DELETE { turnos: [3, 7] }` saca a esas personas;
`DELETE { todo: true }` vacía la cola sin tocar el contador de turnos
(`reiniciarTurnos: true` lo reinicia).

### `POST /api/registro/start` · `POST /api/registro/stop` · `GET /api/registro`

`start` necesita `confirm: true`: abre el formulario a la red local. Devuelve las
direcciones por las que se llega (`urls`) y el estado de la cola. `GET
/api/registro/qr.svg?url=…&escala=8` dibuja el código; `GET /api/registro?qr=1` lo
devuelve dentro del JSON.

Y en el puesto (`:7789`, otro servidor): `GET /` es el formulario y
`POST /registro` con `nombre`, `celular` y `correo` —JSON o formulario normal—
devuelve `{ turno, delante, repetido }`. Volver a mandar el mismo correo o el
mismo celular devuelve el turno que ya se tenía en vez de otro.

### `GET /api/projects` · `GET /api/status` · `GET /api/measure`

`/api/projects` lista lo registrado en la galería, ya separado en `placas` y
`plantillas`. `/api/status` trae el modo en vivo, el estado de la máquina (app y
sistema), el panel activo (`reposo` / `vista-previa` / `trabajando`), las
plantillas y el estado del registro con el recuento de la cola.
`/api/measure?template=&name=` mide cuánto ocupará el nombre en mm.

## El formato `.lp2`

Es un **ZIP sin compresión** (todas las entradas STORED):

```
preview.png        miniatura de la galería
res/<uuid>.png     bitmaps que referencian los objetos
.lpproject         descriptor JSON
```

En el `.lpproject`, `data` y `laserOptions` son **cadenas con JSON embebido**, no objetos — la app les aplica `JSON.parse` al abrir, y romper eso invalida el archivo.

```jsonc
{
  "width": 41.72, "height": 26.51,      // bounding box del contenido en mm
  "file_id": "<32 hex>",
  "data": "[{ ... objetos ... }]",       // string, no array
  "laserOptions": "[{ ... capas ... }]", // string, no array
  "swVersion": 10300, "hwVersion": 12288, "version": 2
}
```

Objetos: `mtype` `10001` = texto, `10010` = imagen. `left`/`top` van en mm sobre el lienzo; `width`/`height` en píxeles del origen, y el tamaño real sale de `width * scaleX`.

Las cinco capas de `laserOptions` son fijas: `layerFill`, `layerPicture`, `layerLine`, `layerCut`, `layerMetalCut`. Las imágenes graban en `layerPicture` y el texto en `layerFill`. Las capas de línea y corte no llevan `printSpeed`.

## Rutas del sistema

| Qué | Dónde |
|---|---|
| Proyectos | `D:\Documentos\LaserPecker\project\*.lp2` |
| Plantillas propias (desde el código) | `plantillas.json` (raíz del proyecto) |
| Plantillas propias (desde el `.exe`) | `%LOCALAPPDATA%\PlacasDivergencyAI\plantillas.json` |
| Cola del registro | `cola.json`, al lado de las plantillas |
| Ejecutable publicado | `web\descargas\DivergencyGrabadoraLaser.exe` |
| Galería (SQLite) | `%APPDATA%\laserpecker_design_spaces\db\MainProject.db`, tabla `lp_project` |
| Perfiles de material | `%APPDATA%\laserpecker_design_spaces\Config\pc_*_material.json` |

Configurables por entorno: `PORT` (7788), `LP_PROJECT_DIR`, `LP_CDP_PORT` (9222), `LP_TEMPLATES_FILE`, `LP_DB_FILE`, `LP_QUEUE_FILE` y `LP_REGISTRO_PORT` (7789). Con `LP_OPEN=0` el `.exe` no abre el navegador al arrancar (y con `LP_OPEN=1` lo abre también desde el código).

`LP_DB_FILE` existe para poder probar el flujo completo sin escribir en la galería de verdad: desviar `USERPROFILE` no vale, porque en Windows `os.homedir()` sale del token del usuario y no de esa variable.

Y no basta con esa variable: **si el modo en vivo está disponible, el registro lo hace la app**, así que va a su galería sin mirar `LP_DB_FILE`. Una prueba aislada de verdad necesita además `live: false` en el cuerpo de la petición.

## Limitaciones conocidas

- **La miniatura de la galería muestra solo el logo, sin el nombre.** No hay rasterizador propio, así que `preview.png` reutiliza el bitmap del logo. Es puramente cosmético: el nombre sí está en el diseño y sí se graba. En la galería cada placa se distingue por su título, que es el nombre de la persona.
- **El centrado del nombre es una estimación en la plantilla `placa`.** Su fuente es AgencyFB-Reg, que no es del sistema, así que el ancho sale del promedio de glifo medido en el original (0.3342 por punto). Design Space remide con la fuente real al abrir, así que nombres con muchas mayúsculas o letras muy anchas pueden quedar un par de milímetros descentrados. Conviene revisar el primero en pantalla antes de lanzar un lote grande. Las dos plantillas de esfero usan Times New Roman y ahí el ancho es exacto.
- **El bounding box de la cabecera baila en el decimal 15.** Los objetos y las cinco capas se reproducen campo por campo, pero `width`/`height` del `.lpproject` pueden diferir del original en ~1e-14 mm: la app los guarda con un orden de operaciones distinto (sus propios números no son consistentes entre sí a ese nivel) y los recalcula al abrir el proyecto. Son femtómetros; se documenta para que nadie los persiga.
- **El registro en la galería es best-effort.** Design Space mantiene el SQLite abierto; si una escritura choca con `SQLITE_BUSY`, la placa llega con `galleryRegistered: false` y el `.lp2` sigue en disco listo para abrir a mano.
- **El modo en vivo muere al cerrar la app.** El puerto de depuración es un argumento de arranque, así que abrirla con el icono normal deja el puente sin modo en vivo. Se arregla desde la landing (**Activar modo en vivo**) o con `launch-app.ps1`, y se evita del todo con el atajo de Escritorio que crea `-CrearAtajo`.
- **La ventana de la app tiene que ser lo bastante grande.** La columna de ajustes crece y deja los botones de grabado por debajo del borde inferior (con 672 px de alto se han visto en y=891). El puente baja el panel antes de pulsar, pero si aun así no cabe, avisa en vez de mandar el click a ninguna parte.
- **El reconocimiento del modo vista previa depende del idioma de la app.** Se localiza por el botón *Salir de vista previa* (y `exit`), porque la app apila los paneles y las clases CSS se repiten entre ellos. Con la app en otro idioma habría que ampliar esa expresión en `src/cdp.js`.
- **La conexión no se puede saber desde el dashboard.** La app solo monta su capa de dispositivo en el lienzo, así que fuera de él la landing muestra la última conexión conocida y lo dice. La comprobación de verdad ocurre al abrir el diseño, antes de cualquier disparo.
- **`POST /api/device/connect` está poco rodado.** El botón se localiza y se pulsa, pero si la app pidiera algo más para enlazar (un diálogo de selección, por ejemplo), el puente lo reporta y hay que terminar en la app.
- **El lienzo no se ha verificado visualmente.** Se comprobó que las placas aparecen en la galería con su nombre y medidas correctas, y que el `.lp2` reproduce el original campo por campo, pero no se ha abierto una para inspeccionar el lienzo. Abre la primera y revisa el centrado del nombre antes de un lote grande.
- **El QR lleva la IP de este equipo, y esa IP cambia.** Al reconectar el wifi o
  cambiar de red, el código impreso deja de valer. Si el cartel se imprime el día
  antes, conviene volver a comprobarlo en el sitio.
- **Un wifi que aísle a los invitados entre sí deja el registro sin efecto.** Es
  habitual en redes de invitados de hoteles y centros de convenciones: los
  teléfonos ven internet pero no ven este equipo. Sin poder tocar la
  configuración del router no hay arreglo desde aquí; el plan B es la lista
  escrita a mano.
- **La cola guarda datos personales en claro.** `cola.json` tiene nombre, celular
  y correo de cada persona, sin cifrar, en el disco de este equipo. Se borra
  desde la landing con *vaciar la cola*, y conviene hacerlo al acabar el evento.
- **Distinguir placas de plantillas es una heurística, no un dato.** Se hace por
  la carpeta donde vive el `.lp2` (y por el nombre). Un formato copiado a la
  carpeta de proyectos y llamado como una persona aparecería como placa; por eso
  la lista se enseña antes de borrar y todo va a la papelera, no a la nada.
- El puente escucha **solo en loopback**: escribe ficheros arbitrarios en disco y no debe quedar expuesto a la red. El puesto de registro sí se abre a la red local, pero es otro servidor con dos rutas y ninguna de ellas toca la máquina.
- **El ejecutable no está firmado y solo es de Windows.** SmartScreen avisa la primera vez, y el `.exe` se construye contra `node.exe` de Windows x64. El código no tiene nada específico de plataforma salvo el modo en vivo (que lanza PowerShell), pero no hay build para otros sistemas.
- **El `.exe` no se actualiza solo.** Es un fichero suelto: para actualizar se reemplaza. Las plantillas propias sobreviven porque viven fuera de él.

## Nota de seguridad ajena a este proyecto

Design Space deja su Express de `:9898` escuchando en `::` (todas las interfaces), no en loopback. Cualquiera en tu red local puede cargar la UI de la app. No es algo que este puente controle, pero conviene saberlo.
