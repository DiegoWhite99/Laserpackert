# Enviar a LaserPecker (Android)

App mínima para tablet: genera la placa (logo + nombre, misma disposición que
las plantillas del puente de escritorio) como una imagen y la manda por
**Compartir** a la app oficial **LaserPecker Design Space** (o la que tengas
instalada), que es la que ya está emparejada por Bluetooth con la máquina.

Esta app **no toca Bluetooth ni la máquina**: solo dibuja la imagen y la pasa.
El grabado en sí (vista previa, potencia, confirmar) se hace dentro de la app
oficial, como ya haces ahora a mano.

## Compilar e instalar

No hay SDK de Android en el equipo donde se escribió este proyecto, así que no
se pudo compilar ni probar aquí. Pasos en un equipo con Android Studio:

1. Abre la carpeta `android-app/` con **Android Studio** (Archivo → Abrir).
   Si pide crear el *Gradle Wrapper*, acepta — no se incluyó el `.jar` binario
   del wrapper en el repo.
2. Deja que sincronice (puede pedir instalar el SDK 34 / Build Tools la
   primera vez).
3. Conecta la tablet por USB con la depuración USB activada, o usa
   **Build → Build Bundle(s)/APK(s) → Build APK(s)** y pasa el `.apk` generado
   a la tablet (por cable, o compartiéndolo).
4. Instala el `.apk` en la tablet (activa "instalar de orígenes desconocidos"
   si lo pide) y asegúrate de tener ya instalada y emparejada la app oficial
   de LaserPecker.

## Uso

1. Elige la plantilla (Esfero, Esfero en línea o Placa).
2. Escribe uno o varios nombres, uno por línea.
3. **Generar y enviar a LaserPecker**: si detecta la app oficial instalada, la
   abre directo con la imagen; si no, aparece el selector normal de Android
   para elegirla a mano.
4. Desde ahí sigues el flujo normal de la app oficial: ajustar, vista previa y
   grabar.

## Si el envío directo no encuentra la app

El código prueba estos paquetes conocidos de Play Store:
`com.hingin.lp1.hiprint` (LaserPecker Design Space) y `com.hingin.l1.hiprint`
(LaserPecker). Si tu versión usa otro paquete, cae automáticamente al selector
de "Compartir" de Android — sigue funcionando, solo con un toque más.

## Ajustar la geometría

Las coordenadas de cada plantilla (`PLANTILLAS` en `MainActivity.kt`) están
copiadas de `src/templates.js` del puente de escritorio. Si cambian las
plantillas allí, hay que actualizarlas aquí a mano — no se comparte código
entre los dos proyectos.
