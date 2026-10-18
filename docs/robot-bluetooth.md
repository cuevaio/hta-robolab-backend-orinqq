# Robot por Bluetooth BLE (UART)

Chrome envía directamente al ESP32 por Bluetooth Low Energy (BLE). Convex
sigue gestionando clases y resultados, pero no interviene en el enlace físico.
El relé y el sketch wifi existentes siguen disponibles para instalaciones anteriores.

## Cargar el firmware

1. Abrir **`firmware/robi/robi.ino`** en Arduino IDE. Es el código completo en
   un solo archivo: configuración, motores, ojos, luces, sonidos y conexión.
   Si lo copias, guardar el archivo como `robi.ino` dentro de una carpeta `robi`.
2. Elegir **ESP32 Dev Module**, con Arduino-ESP32 **3.x** (compilado con 3.3.11).
   Este sketch usa la biblioteca **BLE** incluida en el core (Bluedroid), sin
   instalar otra biblioteca Bluetooth. Mantener el esquema de particiones
   predeterminado de **ESP32 Dev Module** (flash de 4 MB).
3. Instalar **Adafruit GFX Library**, **Adafruit SH110X**, **Adafruit SSD1306** y
   **FluxGarage RoboEyes** con sus dependencias desde el gestor de bibliotecas.
4. Revisar los pines y tiempos al inicio del mismo archivo, cargar y abrir el
   monitor a 115200 baudios. El dispositivo
   se anuncia como **RoboLab**. Cambiar `ROBOT_NOMBRE` para distinguir varios robots.

Se adaptó el `robi.ino` del equipo manteniendo su ejecutor, ojos, sonidos y LED.
No hay credenciales de wifi ni claves de Convex en este firmware.
No ejecuta una demostración al encender: queda esperando órdenes de la web.

Para desarrollar se mantiene también la versión por módulos en
`firmware/robolab_bluetooth/`. Su `.ino` necesita **todos los `.h` de esa carpeta**;
copiar solo ese archivo provoca `Config.h: No such file or directory`.
Después de cambiar un módulo, ejecutar `npm run firmware:bundle` para actualizar
la versión completa. `npm run verify` comprueba que coincidan y prueba que un
sketch exportado siga compilando al copiarlo sin sus cabeceras originales.

| Elemento | Configuración inicial |
|---|---|
| Motor izquierdo / derecho | GPIO 22 / 23, dos MOSFET de un sentido |
| PWM | 500 Hz, 8 bits; avance 75, giro 110 |
| Casilla / giro izquierdo / giro derecho | 1000 ms cada uno |
| Preparación / pausa | 250 / 100 ms |
| OLED SH1106 | SDA 21, SCL 19, dirección 0x3C o 0x3D |
| LED / buzzer pasivo | GPIO 27 / 16 |

**Límites del montaje:** admite A/D/Z, rechaza R antes del primer movimiento.
D y Z son giros en arco, no sobre el centro: hay que calibrar los tiempos y
el espacio físico. El dibujo del tablero no certifica el recorrido del robot.

## Conectar desde la web

1. Encender Bluetooth y abrir la web por HTTPS o localhost en **Chrome**.
2. Abrir **Robot → Bluetooth → Elegir robot** y seleccionar **RoboLab** en el
   selector del navegador. No configurar un puerto COM ni emparejar en ajustes
   del sistema: BLE no exige PIN, bonding ni cifrado.
3. La web activa las notificaciones TX, envía HELLO y espera la identidad del
   firmware antes de mostrar conectado.
4. **Ejecutar** envía al robot vinculado; **Enviar al robot** permite hacerlo desde
   la hoja. **Parar robot** cancela el envío en curso.

Funciona con Web Bluetooth en Chrome para Android y escritorio (Windows,
macOS y ChromeOS). En Ubuntu/Linux hay que activar
`chrome://flags/#enable-experimental-web-platform-features`, reiniciar Chrome y
contar con Bluetooth/BlueZ disponible; Linux tiene soporte experimental y puede
variar según el adaptador. El selector requiere un clic o toque del usuario.
La web comprueba `navigator.bluetooth`; si falta, muestra la alternativa wifi.
Ver [guía oficial de Chrome](https://developer.chrome.com/docs/capabilities/bluetooth)
y [estado por plataforma](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md).
No se necesita el código wifi de seis caracteres.

El servicio UART usa estos UUID de Nordic UART Service:

| Elemento | UUID / propiedad |
|---|---|
| Servicio anunciado | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX (web → robot) | `6e400002-b5a3-f393-e0a9-e50e24dcca9e`, WRITE con respuesta |
| TX (robot → web) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e`, NOTIFY y CCCD 0x2902 |

Las escrituras y notificaciones viajan en fragmentos de **hasta 20 bytes**. Una
línea puede cruzar varios paquetes BLE: solo su LF final permite ejecutarla.
Suscribirse a TX antes de escribir HELLO. Al desconectar, el robot se vuelve a
anunciar y exige una nueva conexión y HELLO; no reanuda programas.

## Contrato de línea, versión 1

ASCII con LF final; se admite CRLF. Un fragmento sin LF nunca se ejecuta. Máximo
200 caracteres por línea; máximo 128 movimientos por programa.

| Laptop → robot | Respuesta |
|---|---|
| `HELLO` | `ROBO/1 ADZ ARC` (o `ROBO/1 A PIVOT` si se deshabilitan giros) |
| `PING` | `PONG` |
| `RUN <id> <secuencia>` | `STATUS <id> OK`, `RUN`, `DONE` o `ERR:<código>` |
| `STOP` | `STATUS <id-activo> ERR:STOPPED`, o `STOPPED` si ya estaba quieto |

El id tiene 1–36 letras ASCII, dígitos o guiones. No se reintenta un RUN
automáticamente. Cada respuesta pertenece a ese id; las respuestas antiguas
no completan otro programa. Dentro de una conexión se recuerdan 64 ids con
su último estado, incluidos los programas rechazados. Repetir un id devuelve
su estado sin volver a ejecutar. Al llenar la memoria responde `ERR:RECONNECT`;
hay que desconectar y elegir el robot otra vez. No hay persistencia de ids tras
reiniciar la placa o iniciar otra conexión física.

Se responde `ERR:BUSY` para otro programa durante la ejecución. Otros errores:
`BAD_CHAR`, `TOO_LONG`, `REVERSE_UNSUPPORTED`, `TURN_UNSUPPORTED`, `TIMING_INVALID`,
`DURATION_LIMIT`, `STOPPED`, `DISCONNECTED`, `HEARTBEAT`, `TIMEOUT`, `NETWORK` y `FRAME`.

La web envía PING cada 1000 ms. Si pasan 3500 ms sin HELLO/PING o se pierde el
cliente BLE, se cancela y apagan los motores. También se detienen al enviar STOP
o P en el monitor, y al superar el tiempo máximo (100 s). Reconectar no reanuda
movimientos. El envío por radio corre en otra tarea y una cola limitada para no
bloquear el reloj de los motores. Los callbacks RX solo encolan bytes (512 como
máximo); si se llena, se cancela la conexión. El parser se ejecuta en loop().
Cada conexión tiene una generación: aunque desconecte y reconecte entre dos
vueltas del loop, se aborta el programa y se limpian fragmentos e ids antiguos.
Las respuestas llevan esa generación y no pasan al siguiente cliente; antes de
volver a anunciar se deja terminar cualquier notificación en curso. Los tiempos
son control por duración, sin sensores de posición ni verificación física de
que el motor se movió.

## Verificación y aceptación

`npm run verify` incluye las pruebas TypeScript y las de C++ del parser,
ejecutor y cola BLE (fragmentos, reconexión con el mismo id y saturación), sin
hardware. Estas últimas necesitan `g++` (o `CXX` apuntando a un compilador
C++17). En Windows puede usarse MSYS2/WSL.

Compilar desde terminal, con las bibliotecas instaladas:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 --jobs 2 firmware/robolab_bluetooth
arduino-cli compile --fqbn esp32:esp32:esp32 --jobs 2 firmware/robi
```

Compilado con Arduino-ESP32 3.3.11: 1 150 902 bytes de programa (87 % de la
partición predeterminada de 1 310 720 bytes) y 49 396 bytes de variables
globales. No necesita cambiar las particiones ni desactivar OTA.

Para aceptar en placa: verificar A/D/Z y ojos/sonidos; comprobar que AR se
rechaza sin mover; enviar dos programas y comprobar BUSY; probar Parar robot,
apagar Bluetooth o cerrar la pestaña y confirmar que se detiene. Calibrar
casilla y ambos arcos con el robot apoyado. La compilación y las pruebas sin
placa no sustituyen esa comprobación física.
