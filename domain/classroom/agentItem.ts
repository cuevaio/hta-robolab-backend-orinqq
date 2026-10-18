/**
 * Las misiones que el docente guardó con el asistente, vistas como un reto más
 * del catálogo. Viven en la base (no en el dominio), así que su id lleva un
 * prefijo: `ia:<id de la misión guardada>`.
 */
import { type CatalogItem, CATALOG_KIND_LABEL } from "./catalog";
import { topicInfo } from "../explore/challenges";

export const AGENT_PREFIX = "ia:";

export const agentChallengeId = (missionId: string): string => `${AGENT_PREFIX}${missionId}`;

/** El id de la misión guardada, o null si `challengeId` no es de una (o viene vacío). */
export function agentIdOf(challengeId: string): string | null {
  if (!challengeId.startsWith(AGENT_PREFIX)) return null;
  const id = challengeId.slice(AGENT_PREFIX.length);
  return id.length > 0 ? id : null;
}

export type AgentMissionFacts = { readonly title: string; readonly objective: string; readonly grade: 2 | 3 | 4 };

/** La ficha de catálogo de una misión del asistente: la consigna es el aprendizaje que escribió el docente. */
export function agentCatalogItem(challengeId: string, mission: AgentMissionFacts): CatalogItem {
  return {
    challengeId,
    title: mission.title,
    topic: "matematicas",
    topicName: topicInfo("matematicas")?.name ?? "Matemáticas",
    level: "primaria",
    kind: "mission",
    kindLabel: CATALOG_KIND_LABEL.mission,
    difficulty: mission.grade,
    emoji: "🧮",
    skill: "Comparar costos y planificar una ruta con energía limitada",
    minutes: "10-15 min",
    story: mission.objective,
    hints: [],
    map: null,
  };
}
