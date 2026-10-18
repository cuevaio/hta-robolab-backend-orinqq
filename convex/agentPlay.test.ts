import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { solveMission } from "../domain/mission/engine";
import { missionFixtures } from "../domain/mission/fixtures";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 18, 15, 0));
});
afterEach(() => vi.useRealTimers());

const MISSION = missionFixtures.find((m) => m.grade === 3)!;
const solved = solveMission(MISSION);
if (solved.status !== "SOLVED") throw new Error("la misión de prueba debe tener solución");
/** El programa ganador como el editor de bloques lo manda: una lista de bloques de movimiento. */
const GOOD = solved.program.commands.map((command) => ({ kind: "move", command }));
const BAD = [{ kind: "move", command: "FORWARD" }];

async function setup() {
  const t = convexTest(schema, modules);
  const anaId = await t.run((ctx) => ctx.db.insert("users", { name: "Ana", email: "ana@colegio.pe" }));
  const luisId = await t.run((ctx) => ctx.db.insert("users", { name: "Luis", email: "luis@colegio.pe" }));
  const teacher = t.withIdentity({ subject: `${anaId}|s1` });
  const other = t.withIdentity({ subject: `${luisId}|s2` });
  const classroom = await teacher.mutation(api.classrooms.create, { level: "primaria", grade: "3.º", section: "A" });
  const second = await teacher.mutation(api.classrooms.create, { level: "primaria", grade: "3.º", section: "B" });
  const { joinCode } = await teacher.query(api.classrooms.get, { classroomId: classroom });
  const joined = await t.mutation(api.student.join, { code: joinCode!, nickname: "Pingüino veloz" });
  if ("error" in joined) throw new Error(joined.error);
  const otherCode = (await teacher.query(api.classrooms.get, { classroomId: second })).joinCode!;
  const outsider = await t.mutation(api.student.join, { code: otherCode, nickname: "Zorro curioso" });
  if ("error" in outsider) throw new Error(outsider.error);
  const missionId = await teacher.mutation(api.agent.save, { mission: MISSION });
  return { t, teacher, other, classroom, second, token: joined.token, outsiderToken: outsider.token, missionId, challengeId: `ia:${missionId}` };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const assignTo = (s: Setup, classroomId = s.classroom) => s.teacher.mutation(api.assignments.create, { challengeId: s.challengeId, visibility: "class", classroomId });
const facts = { runs: 2, hints: 0, ms: 90_000 };

describe("asignar una misión del asistente", () => {
  it("el docente la asigna a su clase y aparece en su lista de retos con su título", async () => {
    const s = await setup();
    await assignTo(s);
    const mine = await s.teacher.query(api.assignments.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ challengeId: s.challengeId, title: MISSION.title, level: "primaria", kind: "mission", studentCount: 1, studentsSolved: 0 });
    expect((await s.teacher.query(api.assignments.listForClassroom, { classroomId: s.classroom }))[0]).toMatchObject({ title: MISSION.title });
  });

  it("no se puede asignar la misión de otro docente ni un id inventado", async () => {
    const s = await setup();
    await expect(s.other.mutation(api.assignments.create, { challengeId: s.challengeId, visibility: "draft" })).rejects.toThrow(/no existe/i);
    await expect(s.teacher.mutation(api.assignments.create, { challengeId: "ia:inventado", visibility: "draft" })).rejects.toThrow(/no existe/i);
    await expect(s.teacher.mutation(api.assignments.create, { challengeId: "ia:", visibility: "draft" })).rejects.toThrow(/no existe/i);
  });

  it("no se repite en la misma clase", async () => {
    const s = await setup();
    await assignTo(s);
    await expect(assignTo(s)).rejects.toThrow(/ya está en la clase/i);
  });

  it("el detalle del reto trae el tablero para que el docente lo pruebe", async () => {
    const s = await setup();
    const id = await assignTo(s);
    const detail = await s.teacher.query(api.assignments.get, { assignmentId: id });
    expect(detail).toMatchObject({ title: MISSION.title, challengeId: s.challengeId, agentMission: { id: MISSION.id } });
  });
});

describe("el alumno juega la misión", () => {
  it("la ve en los retos de su clase y puede pedir su tablero", async () => {
    const s = await setup();
    await assignTo(s);
    const home = await s.t.query(api.student.home, { token: s.token });
    expect(home.classChallenges).toEqual([expect.objectContaining({ challengeId: s.challengeId, title: MISSION.title, kind: "mission", solved: false })]);
    const mission = await s.t.query(api.student.agentMission, { token: s.token, challengeId: s.challengeId });
    expect(mission).toMatchObject({ id: MISSION.id, grade: 3, energyBudget: MISSION.energyBudget });
  });

  it("no la ve un borrador, ni un reto cerrado, ni un alumno de otra clase", async () => {
    const s = await setup();
    // Un borrador (aún sin clase) no lo ve nadie; al asignarlo a la clase deja de ser borrador.
    const id = await s.teacher.mutation(api.assignments.create, { challengeId: s.challengeId, visibility: "draft" });
    expect(await s.t.query(api.student.agentMission, { token: s.token, challengeId: s.challengeId })).toBeNull();
    await s.teacher.mutation(api.assignments.assign, { assignmentId: id, classroomId: s.classroom });
    expect(await s.t.query(api.student.agentMission, { token: s.token, challengeId: s.challengeId })).not.toBeNull();
    expect(await s.t.query(api.student.agentMission, { token: s.outsiderToken, challengeId: s.challengeId })).toBeNull();
    await s.teacher.mutation(api.assignments.close, { assignmentId: id });
    expect(await s.t.query(api.student.agentMission, { token: s.token, challengeId: s.challengeId })).toBeNull();
  });

  it("el servidor vuelve a ejecutar el programa: el correcto cuenta como logrado y el incorrecto no, diga lo que diga el navegador", async () => {
    const s = await setup();
    await assignTo(s);
    expect(await s.t.mutation(api.student.recordChallengePlay, { token: s.token, challengeId: s.challengeId, program: BAD, ...facts })).toEqual({ solved: false });
    expect(await s.t.mutation(api.student.recordChallengePlay, { token: s.token, challengeId: s.challengeId, program: GOOD, ...facts })).toEqual({ solved: true });
    const home = await s.t.query(api.student.home, { token: s.token });
    expect(home.classChallenges[0]!.solved).toBe(true);
  });

  it("un programa mal formado o con órdenes que la misión no permite cuenta como no resuelto, sin romper", async () => {
    const s = await setup();
    await assignTo(s);
    for (const program of [undefined, "no es un programa", [{ kind: "move", command: "SALTAR" }], [{ kind: "repeat", times: 2, body: [] }]]) {
      expect(await s.t.mutation(api.student.recordChallengePlay, { token: s.token, challengeId: s.challengeId, program, ...facts })).toEqual({ solved: false });
    }
  });

  it("no anota partidas de una misión que no es de su clase", async () => {
    const s = await setup();
    await assignTo(s);
    await expect(s.t.mutation(api.student.recordChallengePlay, { token: s.outsiderToken, challengeId: s.challengeId, program: GOOD, ...facts })).rejects.toThrow(/no existe/i);
    await expect(s.t.mutation(api.student.recordChallengePlay, { token: s.token, challengeId: "ia:inventado", program: GOOD, ...facts })).rejects.toThrow(/no existe/i);
  });

  it("el docente ve el resultado en el detalle y en el progreso de la clase", async () => {
    const s = await setup();
    const id = await assignTo(s);
    await s.t.mutation(api.student.recordChallengePlay, { token: s.token, challengeId: s.challengeId, program: GOOD, ...facts });
    const results = await s.teacher.query(api.assignments.results, { assignmentId: id });
    expect(results).toMatchObject({ title: MISSION.title, studentsSolved: 1, solvedPercent: 100 });
    const progress = await s.teacher.query(api.analytics.classRetosProgress, { classroomId: s.classroom });
    expect(progress.retos).toEqual([expect.objectContaining({ title: MISSION.title, solvedPercent: 100 })]);
  });
});

describe("el docente prueba su misión", () => {
  it("lee su misión guardada; la de otro docente no existe", async () => {
    const s = await setup();
    expect(await s.teacher.query(api.agent.get, { id: s.missionId })).toMatchObject({ _id: s.missionId, mission: { id: MISSION.id } });
    expect(await s.other.query(api.agent.get, { id: s.missionId })).toBeNull();
  });
});
