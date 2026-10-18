# Robot por Bluetooth Classic

El objetivo es enviar los programas de RoboLab directamente desde una laptop
al ESP32 clásico, conservando Convex para clases, simulación y resultados.
Se entregan dos PRs: protocolo y firmware en backend; conexión en frontend.

## Hardware y alcance

Se adapta el código proporcionado en `robi.ino`: motores unidireccionales en
GPIO 22/23, PWM 500 Hz de 8 bits, avance 75 y giro 110; casilla y giros de
1000 ms, pausa 100 ms y preparación 250 ms. OLED SH1106 en SDA 21/SCL 19,
LED 27 y buzzer 16, con RoboEyes y sonidos. Los giros son en arco. El montaje
no puede retroceder: se rechaza R antes de ejecutar cualquier paso.
El archivo original y sus credenciales quedan fuera del repositorio.

## Transporte

Bluetooth Classic SPP con BluetoothSerial en Arduino-ESP32 3.x y Web Serial
desde HTTPS o localhost. Chrome de escritorio es el primer entorno de prueba;
se detecta la API y se explica cómo emparejar RoboLab en el sistema operativo.
Bluetooth es la opción inicial de la interfaz y wifi sigue disponible.

Mensajes ASCII terminados en LF (CRLF aceptado), máximo 200 caracteres:

- `HELLO` → `ROBO/1 ADZ ARC`: identidad, movimientos y tipo de giro.
- `PING` → `PONG`: cada 1000 ms desde la web, con vencimiento a los 3500 ms.
- `RUN <id> <secuencia>` → `STATUS <id> OK`, `RUN`, `DONE` o `ERR:<código>`.
- `STOP` cancela el programa activo con `ERR:STOPPED`.

El id tiene 1–36 caracteres alfanuméricos o guiones y la secuencia 1–128
letras A/R/D/Z. Una trama truncada nunca se ejecuta. Un solo programa activo;
los ids ya vistos no vuelven a ejecutarse durante la sesión SPP. Al superar
64 envíos se requiere reconectar. Los estados llevan id para ignorar estados
de otros envíos. No se reenvían automáticamente comandos de movimiento.

El firmware apaga motores ante desconexión, falta de latidos, parada, tiempo
máximo o configuración inválida. La web considera conectado al robot solo
después de su respuesta HELLO, libera el puerto al salir y bloquea envíos
hasta recibir el estado final. Reconectar exige una acción del usuario.

## Verificación

Pruebas del dominio para el framing y capacidades; pruebas C++ del parser,
ejecutor, duplicados, parada y pérdida de conexión; compilación del sketch
para ESP32 clásico; pruebas frontend con streams reales y puerto simulado,
incluyendo fragmentación, errores, cancelación del selector y cleanup.
Se ejecuta npm run verify en ambos repositorios antes de cada commit.
La calibración y recorrido físico requieren la placa del usuario.
