import { parseActivityRequest, type ActivityRequest } from "./request";

/** Casos fijos de evaluación; nunca se ajustan para facilitar una respuesta del modelo. */
export const evaluationScenarios = [
  {
    id: "A", objective: "Comparar el consumo de energía de distintas rutas y seleccionar una ruta que respete un presupuesto.",
    grades: [3], family: "ENERGY_OPTIMIZATION", difficulty: "balanced",
    constraints: { rows: 4, cols: 5, checkpoints: 2, minObstacles: 1, minRough: 1, plainCost: 1, roughCost: 3, maxEnergy: 18 },
  },
  {
    id: "B", objective: "Planificar un recorrido para visitar dos estaciones y sumar el costo energético de los desplazamientos.",
    grades: [2], family: "CHECKPOINT_DELIVERY", difficulty: "guided",
    constraints: { rows: 4, cols: 4, checkpoints: 2, minObstacles: 1, minRough: 0, plainCost: 1, roughCost: 3, maxEnergy: 20 },
  },
  {
    id: "C", objective: "Comparar rutas alternativas y calcular cuál requiere menos energía considerando terrenos de diferente costo.",
    grades: [4], family: "ROUTE_COMPARISON", difficulty: "challenge",
    constraints: { rows: 5, cols: 5, checkpoints: 0, minObstacles: 1, minRough: 2, plainCost: 1, roughCost: 5, maxEnergy: 25 },
  },
] as const;

/** Filtro local de evaluación, NO modifica el contrato productivo.
 * Son condiciones necesarias; aprobarlo no demuestra existencia de una misión certificable.
 */
export function preflightEvaluation(input: unknown): { request: ActivityRequest; issues: string[] } {
  const request = parseActivityRequest(input);
  const c = request.constraints ?? {};
  const cells = (c.rows ?? 5) * (c.cols ?? 5);
  const free = cells - (c.minObstacles ?? 0);
  const issues: string[] = [];
  if (free < 2 + (c.checkpoints ?? 0)) issues.push("No caben inicio, meta y estaciones distintas fuera de obstáculos.");
  if ((c.minRough ?? 0) > free) issues.push("El mínimo de terreno difícil supera las celdas transitables posibles.");
  if (request.family === "CHECKPOINT_DELIVERY" && c.checkpoints === 0) issues.push("Las entregas requieren estaciones.");
  const minCost = Math.min(c.plainCost ?? 1, c.roughCost ?? 1);
  if (c.maxEnergy !== undefined && minCost * ((c.checkpoints ?? 0) + 1) > c.maxEnergy)
    issues.push("La energía no alcanza para entrar en las estaciones distintas y la meta.");
  return { request, issues };
}
