# Asistente de misiones (Anthropic)

El docente describe qué quiere que aprendan; el servidor le pide propuestas a
el modelo, las **valida y resuelve** (`validate_mission`) y solo ofrece las que pasan.
Guardar vuelve a validar. Nada de esto llega al alumno todavía: guardar deja la
misión como borrador del docente (`agentMissions`).

## Funciones (Convex)

| Función | Qué hace |
| --- | --- |
| `agent:status` (query) | `{ configured }`: si el servidor tiene la clave. No la revela. |
| `agent:generate` (action) | Propone una misión por grado (1 a 3, entre 2.º y 4.º). Devuelve `{ status: "not_configured" }` o `{ status: "ok", proposals, failed }`. |
| `agent:save` (mutation) | Revalida y guarda una propuesta elegida como borrador. |
| `agent:listMine` (query) | Las misiones guardadas del docente. |

`failed` trae el grado y un **código** (`SCHEMA_INVALID`, `UNSOLVABLE`,
`PROVIDER_*`…), nunca texto del proveedor. Las plantillas de respaldo del
orquestador no se ofrecen como propuestas del asistente.

## Configurar

Proveedor: **Gemini** (por defecto si hay clave) o Anthropic.

```bash
npx convex env set GEMINI_API_KEY AIza...             # sin ninguna clave: «asistente no activado»
npx convex env set GEMINI_MODEL gemini-3.1-flash-lite # opcional; este es el valor por defecto
# o, con Anthropic:
npx convex env set ANTHROPIC_API_KEY sk-ant-...
npx convex env set AGENT_PROVIDER anthropic           # opcional: fuerza uno si hay las dos claves
```

Con las dos claves y sin `AGENT_PROVIDER`, se usa Gemini. Si `AGENT_PROVIDER` pide un
proveedor sin clave, el asistente queda «no activado» (no cae en el otro en silencio).
La clave solo vive en el despliegue de Convex. No va en la web ni en el repo.

**Modelo de Gemini.** Se probó con la API real (`ROBOLAB_GEMINI_EVAL=1 GEMINI_API_KEY=… npx vitest run generation/gemini.controlled.test.ts`,
máximo 3 llamadas): `gemini-3.1-flash-lite` entregó una misión verificada; `gemini-2.5-flash`
ya no está disponible para cuentas nuevas y `gemini-3.5-flash`/`gemini-3.8-flash` pasaron los 15 s de
espera por llamada. Los modelos cambian: si `status` sigue «activado» pero todo falla con
«No pudimos generar a tiempo», revisa el modelo.

## Rutas alternativas

Cada propuesta de `agent:generate` incluye `alternativeCost: number | null`: la energía
de **otra ruta simple** (sin repetir celdas) que cumple la misión pero **excede el
presupuesto**. Sirve para mostrar al docente «Energía mínima X · otra ruta cuesta N».
Es `null` si no existe esa ruta o si la búsqueda llegó a su tope de 20 000 estados
(`findSimpleAlternative`, `domain/mission/alternative.ts`); `null` no demuestra ausencia
cuando es por tope. En un tablero 5x5 el peor caso medido (tope agotado) tarda unos 17 ms.
La misma búsqueda certifica la alternativa en `validateMechanic`.

## Evaluación controlada

Dos pruebas contra el modelo real, **omitidas por defecto** y solo con aceptación explícita:

- `generation/gemini.controlled.test.ts` (`ROBOLAB_GEMINI_EVAL=1`): un grado, máximo 3 llamadas.
- `generation/scenarios.controlled.test.ts` (`ROBOLAB_EVAL_SCENARIOS=1`): tres casos fijos
  (`generation/evaluationScenarios.ts`), un solo lote, **tope de 9 llamadas HTTP**. Usa el
  mismo selector que producción (`chooseProvider`): Gemini si hay `GEMINI_API_KEY`.

```bash
ROBOLAB_EVAL_SCENARIOS=1 GEMINI_API_KEY=... npx vitest run generation/scenarios.controlled.test.ts
```

Antes de llamar se prevalida cada caso sin red (`preflightEvaluation`). El resultado se guarda
en `node_modules/.cache/robolab-evaluation/results.json` (sin claves ni prompts); si ya existe,
la prueba no repite llamadas: bórralo para un nuevo lote. Un respaldo por plantilla cuenta como fallo.

## Control de gasto

- Cada petición hace como máximo 3 grados × 3 intentos (1 + 2 reparaciones) = 9
  llamadas, de 4096 tokens de salida como tope cada una, con 15 s de espera por
  llamada y 90 s en total.
- Por docente: `AGENT_MAX_PER_HOUR` = 5 y `AGENT_MAX_PER_DAY` = 20 peticiones
  (`convex/agent.ts`). Una solicitud inválida no cuenta.
- Los logs guardan solo metadatos (modelo, duración, reparaciones, código de
  error); nunca el objetivo del docente ni la propuesta.

## Privacidad

Solo se envía el texto del aprendizaje, la dificultad y el grado. Se rechazan
correos, teléfonos y «DNI/pasaporte» en el objetivo (bloqueo básico, no un
detector completo). No se envían datos del aula ni de alumnos.
