# Robot por wifi: respuesta al contrato (robot-protocol.md, §5)

Transporte WiFi para el robot de RoboLab. Cumple el mensaje de programa del
contrato (§2), sus respuestas (§3) y los mínimos de §5. Está probado con
pruebas automáticas (`convex/robot.test.ts` aquí y `src/features/robot/wifiLink.test.ts` en la web)
y de punta a punta con el robot simulado.

## Diseño

Una página HTTPS no puede hablarle a un aparato de la red local por HTTP (el
navegador lo bloquea), así que usamos un **relé en la nube** dentro del mismo
backend (Convex). La web deja el programa; el robot lo recoge con HTTPS:

```
Web ── POST /robot/web/enviar ──▶ relé ◀── GET  /robot/siguiente (cada 0,5 s) ── ESP32
Web ── GET  /robot/web/estado ──▶ relé ◀── POST /robot/estado (OK/RUN/DONE/ERR) ─ ESP32
```

Dirección base: la de las rutas HTTP del despliegue, `https://<despliegue>.convex.site`
(en local, `http://127.0.0.1:3211`).

## Lo que pide el contrato

1. **Emparejamiento.** Código de 6 caracteres sin letras confusas (sin 0/O, 1/I/L).
   El robot lo obtiene con `GET /robot/codigo` y lo muestra (pantalla o monitor
   serie). **Vence a las 12 horas**; al vencer, el robot recibe uno nuevo.
2. **Autorización.** Solo quien conoce el código vigente puede enviar. El robot
   se identifica con una **clave** propia (32 hex) que va solo en su firmware; el
   relé la guarda cifrada (SHA-256).
3. **HTTPS.** Todo va por HTTPS (web → relé y robot → relé).
4. **Idempotencia.** Cada envío lleva un `id`; reenviar el mismo `id` no vuelve a
   ejecutarlo (ni antes ni después de `DONE`). Si hay un programa en curso, el
   segundo envío responde **`ERR:BUSY`** (HTTP 409). Un robot que no da señales
   durante 30 s deja de bloquear.
5. **Latencia.** El robot consulta cada 500 ms y responde `OK` apenas recibe: el
   `OK` llega a la web en ~1 s.
6. **CORS.** Permitido para `http://localhost:*` y para los orígenes de la
   variable del despliegue `ROBOT_WEB_ORIGINS` (separados por comas), por ejemplo:
   `npx convex env set ROBOT_WEB_ORIGINS https://robolab.vercel.app`.

## Rutas para la web

| Petición | Respuesta |
|---|---|
| `POST /robot/web/enviar` con JSON `{"codigo":"7NFEWV","secuencia":"AADZAA","id":"<uuid>"}` | `200 {"estado":"EN_COLA","id":…}` · `400 {"estado":"ERR:BAD_CHAR"}` o `ERR:TOO_LONG` · `409 {"estado":"ERR:BUSY"}` · `404 ERR:NO_ROBOT` · `403 ERR:CODE_EXPIRED` |
| `GET /robot/web/estado?codigo=7NFEWV&id=<uuid>` | `200 {"estado":"EN_COLA"\|"ENTREGADO"\|"OK"\|"RUN"\|"DONE"\|"ERR:<código>"\|"VENCIDO","conectado":true,"robot":"Robi","secuencia":"AADZAA"}` |

`conectado` es `true` si el robot consultó en los últimos 10 s. La web consulta
el estado cada ~500 ms después de enviar (no hay WebSocket: el relé no reenvía,
se consulta). El adaptador listo para la interfaz `RobotLink` del contrato
(§6) está en el repo de la web ([robolab-web](https://github.com/orinqq/robolab-web), `src/features/robot/wifiLink.ts`): es un solo archivo sin imports,
así que otra web lo copia tal cual. El relé normaliza el código y valida las
letras; el adaptador avisa `received` y `running` aunque una consulta se salte
un paso (el robot responde `OK` y `RUN` casi juntos):

```ts
import { createWifiLink } from "./wifiLink";
const link = createWifiLink({ baseUrl: "https://<despliegue>.convex.site", code: () => pedirCodigoAlUsuario() });
await link.connect();          // valida el código
await link.send("AADZAA");     // resuelve al enviar; luego llegan received → running → done
```

## Rutas para el robot (encabezado `X-Clave: <clave>`)

| Petición | Respuesta |
|---|---|
| `GET /robot/codigo` | `200` texto con el código vigente; encabezado `X-Vence-En` en segundos |
| `GET /robot/siguiente` | `200` con el programa en texto sin saltos (`AADZAA`) y encabezado `X-Id` · `204` si no hay nada · `401` clave incorrecta |
| `GET /robot/siguiente?formato=array` | `200` con un arreglo JSON: `["A","A","D","Z","A","A"]` |
| `POST /robot/estado` con cuerpo `OK`, `RUN`, `DONE` o `ERR:<código>` | `200` · `400` si no es una respuesta válida |

Letras (§2): `A` avanzar, `R` retroceder, `D` gira `dir+270` (a la izquierda),
`Z` gira `dir+90` (a la derecha), con `dir` 0 arriba y 90 derecha. La web traduce
"Girar a la izquierda" a `D` y "Girar a la derecha" a `Z`, y una prueba
automática comprueba que el giro en pantalla coincide con la letra.

## Registrar el robot

```bash
npx convex run robot:register '{"name":"Robi"}'
```

Devuelve `code` (el primer código de emparejamiento) y `key` (la clave del
firmware; se guarda cifrada, así que si se pierde hay que registrar el robot
de nuevo).

## Cómo saber el código del robot

- **En el robot:** al encender (y cada 10 minutos) lo imprime en el monitor serie
  del Arduino IDE (115200 baudios): `Codigo del robot: 7NFEWV (vence en 43200 s)`.
  Si el robot tiene pantalla, mostrarlo ahí.
- **Desde la PC del equipo:** `npx convex run robot:list` lista cada robot con su
  código vigente, cuánto le falta para vencer y si está conectado (nunca la clave).
- Si el código venció, el robot recibe uno nuevo la próxima vez que lo consulta.

La **clave** es otra cosa: solo la da `robot:register` una vez, va en el firmware
y se comparte en privado, nunca en el repo ni en grupos.

## Firmware

`firmware/robolab_robot/robolab_robot.ino` hace la conexión, muestra el código,
consulta cada 500 ms, valida las letras (`ERR:BAD_CHAR`, `ERR:TOO_LONG`) y
responde `OK` → `RUN` → `DONE`. Con `PEDIR_ARRAY = true` pide el programa como
arreglo. Solo falta completar `avanzar()`, `retroceder()`, `girarIzquierda()` (D)
y `girarDerecha()` (Z). **No está compilado ni probado en una placa.**

El wifi, el servidor y la clave van en `secretos.h`: copiar
`secretos.ejemplo.h` con ese nombre en la misma carpeta y llenarlo. `secretos.h`
no se sube al repo (está en `.gitignore`); sin él, el sketch compila con los
valores de ejemplo. Para probar contra el backend local de una PC, el servidor
es `http://<IP de la PC en ese wifi>:3211`, con PC y robot en el mismo wifi.

### Placa ESP32

- **Arduino IDE:** instalar "esp32 by Espressif Systems" en el Gestor de placas
  y elegir la placa del robot (por ejemplo, "ESP32 Dev Module"). Las librerías
  `WiFi`, `HTTPClient` y `WiFiClientSecure` vienen incluidas.
- **Wifi de 2.4 GHz:** el ESP32 no se conecta a redes de 5 GHz ni a wifi con
  página de inicio de sesión (como el de muchos eventos). Lo más seguro es el
  punto de acceso de un celular en modo 2.4 GHz.
- **Si ya usa Bluetooth (BLE):** wifi y BLE pueden convivir en el ESP32, pero
  juntos con HTTPS ocupan mucha memoria. Si no compila o se reinicia, elegir en
  Herramientas → Partition Scheme → "Huge APP (3MB No OTA)".
- **Monitor serie** a 115200 baudios: ahí aparece el código del robot y cada
  programa recibido.

## Entorno de pruebas y robot simulado

Sin placa, el simulador hace de robot: muestra su código, recoge programas,
responde `OK`/`RUN`/`DONE` e imprime el recorrido.

```bash
npm run robot:simulador -- --clave <clave> [--servidor https://<despliegue>.convex.site] [--array]
```

Sin `--servidor` usa el backend local. La URL del entorno en la nube se agrega
aquí cuando se despliegue.

## Prueba de aceptación (§7)

1. `D` gira a la izquierda y `Z` a la derecha, igual que la pantalla (prueba automática; falta confirmarlo con el robot físico).
2. `AADZAA` llega igual y el recorrido coincide (probado con el simulador).
3. `AXA` → `ERR:BAD_CHAR`.
4. Dos programas seguidos → el segundo `ERR:BUSY`.
5. Reenviar el mismo envío (mismo `id`) tras `DONE` → no se ejecuta otra vez.
