import { describe, expect, it } from "vitest";
import { missionFixtures } from "../mission/fixtures";
import { AGENT_PREFIX, agentCatalogItem, agentChallengeId, agentIdOf } from "./agentItem";

describe("las misiones del asistente en el catálogo de retos", () => {
  it("su id lleva un prefijo que no choca con los ids del dominio", () => {
    expect(AGENT_PREFIX).toBe("ia:");
    expect(agentChallengeId("abc123")).toBe("ia:abc123");
    expect(agentIdOf("ia:abc123")).toBe("abc123");
    expect(agentIdOf("inicial-paseo")).toBeNull();
    expect(agentIdOf("primaria-tecnologia-materiales")).toBeNull();
    expect(agentIdOf("ia:")).toBeNull();
  });

  it("se ve como cualquier misión de Primaria: título, consigna del docente y tipo «Misión»", () => {
    const mission = missionFixtures.find((m) => m.grade === 3)!;
    const item = agentCatalogItem("ia:x1", { title: mission.title, objective: "Comparar costos.", grade: 3 });
    expect(item).toMatchObject({
      challengeId: "ia:x1",
      title: mission.title,
      level: "primaria",
      kind: "mission",
      kindLabel: "Misión",
      story: "Comparar costos.",
      map: null,
      hints: [],
    });
    expect(item.difficulty).toBe(3);
  });

  it("la dificultad sigue al grado y nunca sale del 1 al 4", () => {
    expect(agentCatalogItem("ia:a", { title: "t", objective: "o", grade: 2 }).difficulty).toBe(2);
    expect(agentCatalogItem("ia:a", { title: "t", objective: "o", grade: 4 }).difficulty).toBe(4);
  });
});
