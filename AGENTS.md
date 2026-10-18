# Guía para agentes y colaboradores

Backend de RoboLab: funciones en Convex, dominio compartido en TypeScript puro y
robot por wifi. La web (Vite + React) está en otro repo,
[robolab-web](https://github.com/orinqq/robolab-web), y consume este como paquete
npm desde git. El README explica el producto; aquí van las reglas para trabajar
en el código.

## Comandos

```bash
npm ci                 # instalar (usa el lockfile)
npx convex dev         # backend local; déjalo corriendo (regenera convex/_generated)
npm run setup          # una vez por backend: claves de sesión, SITE_URL y correo en consola
npm run verify         # tipos + lint + pruebas: debe pasar antes de cada commit
```

Un agente sin cuenta de Convex puede levantar el backend local sin preguntas con
`CONVEX_AGENT_MODE=anonymous npx convex dev --once` (o sin `--once` para dejarlo vivo).

Útiles: `npx convex run demo:seed '{"email":"…","today":"AAAA-MM-DD"}'` (datos de
ejemplo), `npx convex run robot:register '{"name":"Robi"}'` (robot por wifi),
`npx convex run explore:stats` (uso anónimo), `npx convex logs` (correos en modo consola).
Robot: `npm run robot:simulador -- --clave <clave>` hace de robot sin placa; el
protocolo está en `docs/robot-wifi.md` (D gira a la izquierda, Z a la derecha).

## Arquitectura (respétala)

- `domain/` es TypeScript puro: sin React, sin Convex, sin red, sin tipos de Node.
  Lo usan el servidor y la web. Toda regla de negocio nueva va aquí, con su prueba.
- `convex/` son las funciones del backend. Toda consulta del docente pasa por
  `convex/lib/access.ts`; las del alumno, por su token de sesión.
- El servidor es la autoridad: vuelve a simular los programas, cuenta las
  ejecuciones y califica con su reloj. Nunca confíes en lo que manda el navegador.
- Al alumno nunca se le envía la respuesta correcta (`correctOption`).
- Las validaciones (nombres, contraseña, preguntas) están en el dominio y se usan
  igual en el formulario de la web y en el servidor: no las dupliques.
- Las variables del despliegue se leen con `deploymentEnv()` (`convex/lib/env.ts`),
  no con `process.env`: la web también compila estos archivos al importar los tipos.

## Contrato con la web

- La web importa solo `@robolab/backend/convex/_generated/api`,
  `.../convex/_generated/dataModel` y `.../domain/<ruta>` (campo `exports` de
  `package.json`). Si agregas un módulo del dominio, ya queda expuesto; si
  necesitas exponer otra cosa, agrégala a `exports`.
- No cambies argumentos ni resultados de funciones que la web usa, ni las quites:
  agrega la nueva, migra la web y recién después quita la vieja, en otro cambio.
- La web fija en su lockfile el commit de este repo que instaló. Después de
  mergear a `main`, hay que correr en la web
  `npm install git+https://github.com/orinqq/robolab-backend.git#main` y commitear.
- Sin script `prepare` en `package.json`: npm lo correría al instalar desde git.

## Cómo trabajar

- Prueba primero: un error se reproduce con una prueba que falla, y esa prueba
  se queda. Las pruebas del backend usan `convex-test` (no necesitan backend).
- Corre `npm run verify` antes de cada commit; GitHub Actions lo vuelve a correr.
- Mensajes para el usuario (correos, errores que llegan a la web) en español
  neutro y cortos.
- Commits pequeños, en español, que expliquen el porqué. Trabaja en una rama y
  abre un pull request; no hagas `push --force` sobre `main`. Cada push a `main`
  despliega a producción si el repo tiene el secreto `CONVEX_DEPLOY_KEY`.

## Cuidado con

- `convex/_generated/` se sube al repo pero no se edita a mano: lo regenera
  `npx convex dev`. Si cambias funciones de `convex/`, corre `convex dev` antes
  del chequeo de tipos y sube lo regenerado en el mismo commit.
- Con `convex dev` corriendo, no reescribas historia (rebase): regenera archivos
  a mitad del proceso. Detenlo primero.
- Secretos (claves de API, contraseñas, la clave del robot, la deploy key) nunca
  van al repo: van con `npx convex env set` o en los secretos de GitHub. No subas
  `.env.local`, `.env.test.local` ni `firmware/**/secretos.h`.
- En Windows PowerShell 5.1, `Get-Content`/`Set-Content` dañan las tildes al
  editar archivos; usa un editor o herramientas que respeten UTF-8.
