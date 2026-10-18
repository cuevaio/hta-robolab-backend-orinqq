# Robot por Bluetooth Classic (SPP)

La laptop envía directamente al ESP32 clásico por Bluetooth Classic. Convex
sigue gestionando clases y resultados, pero no interviene en el enlace físico.
El relé y el sketch wifi existentes siguen disponibles para instalaciones anteriores.

## Cargar el firmware

1. Abrir **`firmware/robi/robi.ino`** en Arduino IDE. Es el código completo en
   un solo archivo: configuración, motores, ojos, luces, sonidos y conexión.
   Si lo copias, guardar el archivo como `robi.ino` dentro de una carpeta `robi`.
2. Elegir **ESP32 Dev Module**, con Arduino-ESP32 **3.x** (compilado con 3.3.11).
   Este sketch usa `BluetoothSerial`, no BLE; requiere un ESP32 clásico.
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

1. Emparejar **RoboLab** en los ajustes Bluetooth de la laptop.
2. Abrir la web por HTTPS o localhost en Chrome de escritorio (117 o superior).
3. Abrir **Robot → Bluetooth → Elegir robot** y seleccionar el puerto del robot.
   Según el sistema puede aparecer como RoboLab, puerto Bluetooth o puerto COM.
4. La web envía HELLO y espera la identidad del firmware antes de mostrar conectado.
5. **Ejecutar** envía al robot vinculado; **Enviar al robot** permite hacerlo desde
   la hoja. **Parar robot** cancela el envío en curso.

La presencia de `navigator.serial` se comprueba en tiempo de ejecución; si el
navegador no lo expone, la web avisa y ofrece wifi. Web Bluetooth corresponde a
BLE; para Classic se usa [Web Serial sobre RFCOMM/SPP](https://developer.chrome.com/blog/serial-over-bluetooth).
El selector del navegador requiere una acción del usuario y solo muestra puertos
disponibles o emparejados. No se necesita el código wifi de seis caracteres.

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
cliente SPP, se cancela y apagan los motores. También se detienen al enviar STOP
o P en el monitor, y al superar el tiempo máximo (100 s). Reconectar no reanuda
movimientos. El envío por radio corre en otra tarea y una cola limitada para no
bloquear el reloj de los motores. Los tiempos son control por duración, sin
sensores de posición ni verificación física de que el motor se movió.

## Verificación y aceptación

`npm run verify` incluye las pruebas TypeScript y las de C++ del parser y
ejecutor, sin hardware. Estas últimas necesitan `g++` (o `CXX` apuntando a un
compilador C++17). En Windows puede usarse MSYS2/WSL.

Compilar desde terminal, con las bibliotecas instaladas:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/robi
```

Para aceptar en placa: verificar A/D/Z y ojos/sonidos; comprobar que AR se
rechaza sin mover; enviar dos programas y comprobar BUSY; probar Parar robot,
apagar Bluetooth o cerrar la pestaña y confirmar que se detiene. Calibrar
casilla y ambos arcos con el robot apoyado. La compilación y las pruebas sin
placa no sustituyen esa comprobación física.
