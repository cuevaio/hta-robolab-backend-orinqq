# Robot por USB Serial (BLE opcional)

Chrome envía las órdenes al ESP32 por el cable USB, mediante UART a **115200
baudios**. Convex sigue gestionando clases y resultados, pero no interviene en
el enlace físico. El firmware conserva motores, calibración, pines, ojos,
sonidos y luces; USB Serial es el transporte predeterminado.

## Cargar el firmware

1. Abrir **`firmware/robi/robi.ino`** en Arduino IDE. Es el código completo en
   un archivo, sin cabeceras locales. Si se copia, guardar como `robi.ino` dentro
   de una carpeta `robi`.
2. Elegir **ESP32 Dev Module**, Arduino-ESP32 **3.x** (compilado con 3.3.11),
   flash de 4 MB y particiones predeterminadas. `ROBOLAB_USAR_BLE` debe quedar
   en **0**, como viene en el archivo.
3. Instalar **Adafruit GFX Library**, **Adafruit SH110X**, **Adafruit SSD1306** y
   **FluxGarage RoboEyes** con sus dependencias desde el gestor de bibliotecas.
4. Revisar los pines y tiempos al inicio del archivo y cargar con un cable USB
   que transmita datos. Cerrar el monitor serie antes de conectar desde Chrome.

No necesita wifi, clave de Convex ni emparejamiento Bluetooth. Al encender queda
esperando órdenes; no ejecuta una demostración.

Para desarrollar está la versión por módulos en `firmware/robolab_bluetooth/`
(el nombre de la carpeta se conserva). Su `.ino` necesita todos los `.h` vecinos.
Tras cambiar un módulo, `npm run firmware:bundle` actualiza el sketch completo;
`npm run verify` comprueba el bundle y ejecuta las pruebas nativas.

| Elemento | Configuración inicial |
|---|---|
| Motor izquierdo / derecho | GPIO 22 / 23, dos MOSFET de un sentido |
| PWM | 500 Hz, 8 bits; avance 75, giro 110 |
| Casilla / giro izquierdo / giro derecho | 1000 ms cada uno |
| Preparación / pausa | 250 / 100 ms |
| OLED SH1106 | SDA 21, SCL 19, dirección 0x3C o 0x3D |
| LED / buzzer pasivo | GPIO 27 / 16 |

**Límites del montaje:** admite A/D/Z y rechaza R antes de moverse. D y Z son
arcos; hay que calibrar tiempos y espacio. El tablero no certifica el recorrido.

## Conectar desde Chrome

1. Conectar el ESP32 por USB y cerrar Arduino Serial Monitor u otro programa
   que tenga ocupado el puerto.
2. Abrir la web por HTTPS o localhost en **Chrome de escritorio**.
3. Abrir **Robot → USB → Elegir robot** y seleccionar el ESP32 o su puente
   USB serie (por ejemplo CH340, CP210x o USB Serial).
4. Esperar la respuesta `ROBO/1 ADZ ARC` antes de ejecutar. Si abrir el puerto
   reinicia la placa, la web reintenta el saludo durante su arranque.
5. **Parar robot** envía STOP. Desconectar la web impide nuevos envíos.

La web comprueba `navigator.serial` y requiere un clic para elegir el puerto.
En Linux, el usuario debe tener permisos sobre el dispositivo serie (habitualmente
el grupo `dialout`); si se acaba de agregar, cerrar sesión y entrar de nuevo.
La conexión USB por Web Serial está orientada a Chrome de escritorio; Android
y Chrome para iOS no son el destino de este flujo.
Ver [guía oficial de Chrome](https://developer.chrome.com/docs/capabilities/serial).

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

La web envía PING cada 1000 ms. Si pasan 3500 ms sin HELLO/PING, se cancela
la ejecución y se apagan los motores. También se detienen con STOP y al superar
el tiempo máximo (100 s). Los tiempos son control por duración, sin sensores de
posición ni verificación física de que el motor se movió.

En USB, cada línea **HELLO** inicia una sesión nueva con salidas apagadas e ids
vacíos. Al abrir el puerto, Chrome escribe `\x00\nSTOP\nHELLO\n`: NUL invalida
una trama parcial antes de cerrarla con LF; STOP cancela cualquier programa
antes del saludo. Solo se
reintenta ese saludo mientras se conecta; nunca se reenvía RUN automáticamente.

El puente CH340 no informa al ESP32 de que se cerró el puerto o desconectó el
USB; por eso sigue siendo obligatorio el latido de 3500 ms. Reconectar exige
HELLO y no reanuda programas. Todos los caracteres de Serial van al parser: la
letra P de PING no se interpreta como una parada. Para parar desde el monitor,
enviar la línea completa **STOP** con LF.

Las respuestas salen por una tarea y una cola acotada, para que una escritura
lenta no bloquee el reloj de motores. Un HELLO descarta respuestas pendientes
de la sesión anterior. El parser de UART también tiene tamaño fijo y rechaza
líneas que superen el límite del protocolo.

## BLE opcional para experimentación

La variante BLE se conserva detrás de `ROBOLAB_USAR_BLE=1`; no está habilitada
en el binario USB predeterminado. Usa la biblioteca BLE Bluedroid incluida en
Arduino-ESP32 3.3.11, nombre **RoboLab**, sin exigir bonding ni cifrado. No hay que
emparejar en ajustes del sistema. Requiere un cliente Web Bluetooth o BLE UART;
el flujo actual de la web usa USB.

| Elemento | UUID / propiedad |
|---|---|
| Servicio anunciado | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX (cliente → robot) | `6e400002-b5a3-f393-e0a9-e50e24dcca9e`, WRITE con respuesta |
| TX (robot → cliente) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e`, NOTIFY y CCCD 0x2902 |

Suscribirse a TX antes de HELLO. Escrituras y notificaciones usan fragmentos de
hasta 20 bytes; el LF completa la línea. RX encola como máximo 512 bytes y el
parser corre en loop(); las generaciones aíslan conexiones, fragmentos y
respuestas. Al desconectar se anuncia de nuevo después del último envío viejo.

Web Bluetooth está disponible en Chrome para Android, Windows, macOS y
ChromeOS. En Ubuntu/Linux requiere
`chrome://flags/#enable-experimental-web-platform-features`, reiniciar Chrome y
Bluetooth/BlueZ; su soporte es experimental. En las pruebas físicas iniciales
se detectó el anuncio NUS, pero el enlace Linux se interrumpió durante el
descubrimiento de servicios; por eso se conserva como opción de experimentación.
Ver [Web Bluetooth en Chrome](https://developer.chrome.com/docs/capabilities/bluetooth).

## Verificación y aceptación

`npm run verify` incluye pruebas TypeScript, C++ del ejecutor/parser, UART
(HELLO nuevo, ids, fragmentos, PING y watchdog) y BLE. Requiere `g++` o un
compilador C++17 indicado en `CXX`; en Windows puede usarse MSYS2/WSL.

Compilar USB desde terminal, con las bibliotecas instaladas:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 --jobs 2 firmware/robolab_bluetooth
arduino-cli compile --fqbn esp32:esp32:esp32 --jobs 2 firmware/robi
```

Para compilar la variante BLE opcional:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 --jobs 2 --build-property 'compiler.cpp.extra_flags=-DROBOLAB_USAR_BLE=1' firmware/robi
```

Antes de usar con niños, probar HELLO, PING, STOP, cierre/reapertura y pérdida de
latidos. Verificar A/D/Z y ojos/sonidos en placa y calibrar casilla y arcos.
Las pruebas nativas y compilar no sustituyen la comprobación física.
