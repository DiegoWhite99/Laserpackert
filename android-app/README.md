# Enviar a LaserPecker (Android)

App mínima para tablet: genera un proyecto **`.lp2` real** —el mismo formato
que arma este puente en escritorio (`src/lp2.js` / `src/badge.js` /
`src/templates.js`)— y lo abre directo en el lienzo de la app oficial
**LaserPecker Design Space**, que es la que ya está emparejada por Bluetooth
con la máquina.

Esta app **no toca Bluetooth ni la máquina**: solo arma el archivo y lo pasa.
El grabado en sí (vista previa, confirmar) se hace dentro de la app oficial,
como ya haces ahora a mano.

## Cómo se descubrió que esto era posible

La app oficial de Android (`com.hingin.lp1.hiprint`) usa el mismo formato de
proyecto que la de escritorio: su manifiesto declara una actividad exportada,
`com.angcyo.laserpacker.open.CanvasOpenActivity`, con un `intent-filter` que
acepta `ACTION_VIEW`/`ACTION_SEND` de cualquier `file://`/`content://`. Y sus
propios strings internos (`.dex`) mencionan literalmente `.lpproject`,
`laserOptions`, `layerFill`, `layerPicture`, `file_id`, `swVersion`,
`hwVersion` — los mismos nombres de campo que ya tenía reverse-engineered este
proyecto para el `.lp2` de escritorio. Verificado inspeccionando la APK
pública (versión 5.6.1) con `aapt dump xmltree` y un extractor de strings de
sus `classes*.dex`, no adivinado.

Esto significa que el `.lp2` que arma esta app **no es una imagen aproximada**:
es geometría, capas y potencias reales, igual que si se hubiera creado a mano
en Design Space.

## Compilar e instalar

No hay SDK de Android en el equipo donde se escribió este proyecto, así que
se compiló con las herramientas de línea de comandos (`cmdline-tools` +
Gradle 8.10.2 descargados aparte, sin Android Studio). Para modificarlo:

1. Abre la carpeta `android-app/` con **Android Studio** (Archivo → Abrir).
   Si pide crear el *Gradle Wrapper*, acepta.
2. Deja que sincronice (puede pedir instalar el SDK 34 la primera vez).
3. **Build → Build Bundle(s)/APK(s) → Build APK(s)**, y pasa el `.apk` a la
   tablet.
4. Instálalo (activa "orígenes desconocidos" si lo pide) con la app oficial
   de LaserPecker ya instalada y emparejada.

## Uso

1. Elige la plantilla (Esfero, Esfero en línea o Placa).
2. Escribe uno o varios nombres, uno por línea.
3. **Generar y enviar a LaserPecker**: arma el `.lp2` del primer nombre y abre
   la app oficial directo en el lienzo con ese proyecto cargado. Si hay más
   nombres en la lista, se van quitando uno a uno: vuelve a pulsar el botón
   para mandar el siguiente.
4. Desde ahí sigues el flujo normal de la app oficial: vista previa y grabar.

## Si no encuentra la actividad exacta

El código intenta, en orden:

1. Abrir `com.angcyo.laserpacker.open.CanvasOpenActivity` directo, en
   `com.hingin.lp1.hiprint` o `com.hingin.l1.hiprint`.
2. Si esa actividad no resuelve (versión distinta de la app), `ACTION_VIEW`
   genérico contra el paquete completo, dejando que la propia app elija.
3. Si nada de eso resuelve, el selector de "Abrir con" de Android.

Si tu versión de la app usa otro paquete o movió esa actividad, el paso 3
sigue funcionando igual, solo con un toque más.

## Ajustar la geometría

`Templates.kt` (`PLANTILLAS`) y `Lp2Builder.kt` son el port a Kotlin de
`src/templates.js` y `src/lp2.js`/`src/badge.js` del puente de escritorio.
Si cambian las plantillas allí, hay que actualizarlas aquí a mano — no se
comparte código entre los dos proyectos.
