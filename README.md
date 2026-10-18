# RoboLab: backend

Backend de [RoboLab](https://github.com/orinqq/robolab-web), la app de retos de
programación con un robot para Inicial y Primaria (Hack the Andes 2026, track
Educación Escolar). Este repo tiene todo lo que no es pantalla:

- `convex/`: esquema, consultas, mutaciones, acciones y rutas HTTP del backend
  en [Convex](https://convex.dev), con autenticación de docentes
  (`@convex-dev/auth`), clases con código (`ABC-123`) a las que los alumnos se
  unen con un apodo, retos asignados a cada clase con sus resultados,
  evaluaciones, ranking, carreras y retos colaborativos en vivo, retos abiertos anónimos, correo de recuperación y el
  relé del robot.
- `domain/`: el dominio compartido en TypeScript puro (sin React, sin Convex,
  sin red): intérprete de bloques, simulador, mapas y niveles, calificación,
  códigos, reglas de validación, retos y protocolo del robot. Lo usan el
  servidor y la web: es el mismo código en los dos lados.
- `scripts/`: `setup.mjs` deja listo un despliegue nuevo y `robot-sim.mjs`
  hace de robot sin placa.
- `firmware/` y [docs/robot-wifi.md](docs/robot-wifi.md): el ESP32 que recibe el
  programa por wifi y el contrato que cumple.

También está disponible el enlace directo por **Bluetooth Classic SPP** para
ESP32 clásico, con el firmware de motores, ojos y sonidos del equipo. La guía
de carga, emparejamiento y capacidades está en [docs/robot-bluetooth.md](docs/robot-bluetooth.md).
El sketch listo para copiar al Arduino IDE es
[`firmware/robi/robi.ino`](firmware/robi/robi.ino): incluye en un solo archivo
la configuración, los motores, ojos, luces, sonidos y el receptor de órdenes.

La web (Vite + React) vive en [orinqq/robolab-web](https://github.com/orinqq/robolab-web)
y consume este repo como paquete npm (ver "Cómo lo consume la web").

## Cómo correrlo

Requisitos: **Node 22.12 o superior** (hay un `.nvmrc`) y git.

```bash
git clone https://github.com/orinqq/robolab-backend.git
cd robolab-backend
npm ci
```

**1. Backend local.** En una terminal, y dejarla abierta:

```bash
npx convex dev
```

La primera vez pregunta cómo trabajar: elige **correr Convex en local, sin
cuenta** (o inicia sesión si vas a usar la nube). Crea tu propio backend, sube
las funciones, regenera `convex/_generated/` y escribe `.env.local` con
`CONVEX_DEPLOYMENT`, `CONVEX_URL` y `CONVEX_SITE_URL`. Cada computadora tiene
su backend y sus datos; no se comparten.

**2. Configuración del despliegue (una vez).** En otra terminal:

```bash
npm run setup
```

Genera las claves de inicio de sesión del docente (`JWT_PRIVATE_KEY`, `JWKS`),
fija `SITE_URL` en `http://localhost:5173` y deja el correo de recuperación en
modo consola (`MAIL_PROVIDER=console`: el código aparece en `npx convex logs`).
Solo agrega lo que falta; se puede correr de nuevo sin riesgo.

**3. Web.** Clonar [robolab-web](https://github.com/orinqq/robolab-web) y poner
en su `.env.local` la dirección de este backend:
`VITE_CONVEX_URL=<el CONVEX_URL de tu .env.local>`. Su README explica el resto.

Para enviar correos de verdad, el despliegue necesita `MAIL_PROVIDER=resend`,
`RESEND_API_KEY` y `MAIL_FROM` (con `npx convex env set`, nunca en el código).
`.env.example` resume todas las variables.

### Datos de demostración

Para presentar la gráfica de progreso con historia: registrar un docente en la
web y luego (en bash o PowerShell; en cmd las comillas simples no funcionan)

```bash
npx convex run demo:seed '{"email":"correo-del-docente","today":"AAAA-MM-DD"}'
```

Agrega una clase de Inicial con 12 alumnos ficticios, cuatro evaluaciones
pasadas ya rendidas y una para hoy que se puede jugar en vivo. Las notas salen
de respuestas simuladas con semilla fija y se califican con las mismas reglas
que una evaluación real. Es una función interna: no se puede llamar desde el
navegador y no guarda contraseñas.

`npx convex run explore:stats` da las cifras de uso anónimo de los retos abiertos.

### Retos en vivo

`api.liveRooms` permite crear salas para una clase y recibir sus cambios con
consultas reactivas de Convex. El docente crea el laberinto, espera al menos un
participante, inicia y cierra la sala. Los alumnos usan sus sesiones actuales;
deben unirse antes del inicio y conservan sus resultados al volver.

En carrera (`race`), cada alumno envía su programa de hasta 60 movimientos. El
servidor lo simula desde el inicio y asigna un puesto único al llegar, incluso
si dos llegadas comparten milisegundo. Los demás pueden seguir hasta el cierre;
los programas rivales nunca se incluyen en la respuesta al alumno.

En colaboración (`cooperative`), todos editan un programa compartido. Cada
edición y ejecución lleva su revisión; una pestaña desactualizada recibe un
error y debe revisar el programa confirmado. El servidor ejecuta la versión
compartida y bloquea cambios después de resolver o cerrar.

Las solicitudes de ejecución llevan un `requestId` estable para reintentar sin
duplicar contadores ni llegadas. Cada participante puede ejecutar como máximo
una vez cada 250 ms. Cada sala admite 100 participantes y las listas muestran
las últimas 30 salas, incluidas las cerradas. Al borrar la clase, su historial
en vivo se elimina por lotes internos de 100 filas, incluidos los reintentos.
Los participantes representan inscripciones, no presencia en línea.

Los tres mapas fijos y las reglas puras viven en `domain/live/`. Las pruebas
comprueban soluciones, permisos por clase, empates, reenvíos, revisiones y
limpieza en cascada.

### Robot por wifi y simulador

```bash
npx convex run robot:register '{"name":"Wayra"}'          # devuelve el código y la clave del firmware
npx convex run robot:rename '{"from":"Kusi","to":"Wayra"}' # cambia el nombre que muestra la web
npx convex run robot:list                                 # robots, código vigente y si están conectados
npm run robot:simulador -- --clave <clave> [--servidor https://<despliegue>.convex.site]
```

Sin `--servidor`, el simulador usa el `CONVEX_SITE_URL` de `.env.local`. El
protocolo, las rutas HTTP y el firmware del ESP32 están en
[docs/robot-wifi.md](docs/robot-wifi.md). La clave del robot va en
`firmware/robolab_robot/secretos.h`, que no se sube al repo.

## Cómo lo consume la web

La web instala este repo como dependencia git, directo desde GitHub por https
(en Vercel no hay llaves ssh):

```bash
npm install git+https://github.com/orinqq/robolab-backend.git#main
```

npm guarda en el `package-lock.json` de la web el **commit exacto** que
instaló (`resolved: git+https://...#<sha>`). Por eso, **después de cambiar el
backend hay que actualizarlo en la web**: volver a correr ese `npm install` y
commitear el lockfile. Si no, la web sigue compilando contra el commit viejo.

El paquete solo expone lo que la web usa (campo `exports`):

| Import | Qué es |
|---|---|
| `@robolab/backend/convex/_generated/api` | las referencias tipadas a las funciones (`api.student.start`, ...) |
| `@robolab/backend/convex/_generated/dataModel` | los tipos `Id<"tabla">` y `Doc<"tabla">` |
| `@robolab/backend/domain/<ruta>` | cualquier módulo del dominio, por ejemplo `domain/game/program` |

Se publican los archivos `.ts` tal cual (campo `files`: `convex` y `domain`);
Vite y TypeScript de la web los compilan. No hay script `prepare` ni paso de
build: si se agregara, npm lo ejecutaría en cada instalación desde git.

### Reglas de contrato

Mientras la web apunte a `main`, cada push a `main` es una versión que la web
puede instalar. Para no romperla:

- **No cambies los argumentos ni el resultado de una función que la web ya usa,
  ni la quites.** Agrega una función nueva (o un argumento opcional), cambia la
  web para usarla y, cuando ningún commit de la web la necesite, quita la vieja
  en un cambio aparte.
- Lo mismo con el dominio: las firmas exportadas de `domain/` son API pública.
- Correr `npx convex dev` después de tocar `convex/` para que
  `convex/_generated/` quede al día, y subirlo en el mismo commit.
- `npm run verify` en verde antes de cada push (GitHub Actions lo vuelve a correr).

## Despliegue

El despliegue de producción ya existe en Convex. Para subir las funciones a mano,
con sesión iniciada (`npx convex login`):

```bash
npx convex deploy
```

La primera vez, configurarlo con
`npm run setup -- --prod --site-url https://<la web en Vercel>` (claves de sesión
y `SITE_URL`; no toca `MAIL_PROVIDER`, así la app avisa que el correo no está
configurado hasta que se agregue Resend) y permitir el origen de la web para el
robot: `npx convex env set --prod ROBOT_WEB_ORIGINS https://<la web>`.

**Automático.** `.github/workflows/desplegar.yml` corre en cada push a `main`:
`npm ci`, `npm run verify` y `npx convex deploy`. El deploy usa el secreto
`CONVEX_DEPLOY_KEY` (una *production deploy key* del panel de Convex, Settings →
Deploy keys) que pone quien administra el repo en Settings → Secrets and
variables → Actions. Si el secreto está vacío, ese paso se salta y el flujo solo
verifica.

La web se despliega aparte, en Vercel, con `VITE_CONVEX_URL` apuntando a este
despliegue: ver el README de [robolab-web](https://github.com/orinqq/robolab-web).

## Pruebas y calidad

```bash
npm run verify     # tipos + lint + pruebas
```

La verificación incluye las pruebas C++17 del firmware Bluetooth: requiere
`g++` o la variable `CXX` apuntando a otro compilador C++17.

Las pruebas del dominio corren en Node; las del backend usan
[convex-test](https://github.com/get-convex/convex-test) en `edge-runtime`, sin
necesidad de un backend levantado: cubren la autorización entre docentes, la
validación de datos, el flujo completo del alumno, los retos abiertos, la
recuperación de contraseña y el relé del robot. Las reglas para colaborar
(personas o agentes de IA) están en [AGENTS.md](AGENTS.md).

## Decisiones

- **Convex** como backend: base de datos reactiva (los resultados en vivo no
  necesitan código extra), funciones tipadas de punta a punta y autenticación
  integrada.
- **El servidor manda.** Cada vez que el alumno toca "Ejecutar", el servidor
  vuelve a simular el programa con el mismo dominio y lo anota; los tiempos
  salen de su reloj. La respuesta correcta nunca viaja al alumno.
- **Dominio como paquete, no como copia.** La web y el servidor comparten
  `domain/` por npm para que una regla del juego no exista dos veces.
- **Fechas como texto `AAAA-MM-DD`**: "hoy" significa lo mismo para el docente,
  el alumno y el servidor, sin problemas de zona horaria.
- **Relé en la nube para el robot**: una página HTTPS no puede hablarle a un
  aparato de la red local, así que el robot recoge el programa del backend.
