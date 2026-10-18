import { describe, expect, it } from "vitest";
import { missionFixtures } from "../../domain/mission/fixtures";
import { localRepairHint } from "./ollama-guidance";
const mission = {
  ...missionFixtures[0]!, grid: { rows: 3, cols: 3, cells: Array.from({length:9}, (_,i) => ({ position: {row:Math.floor(i/3),col:i%3},terrain:"plain",cost:10,obstacle:false })) },
  start:{row:0,col:0},goal:{row:2,col:2},initialHeading:90,checkpoints:[{id:"semillas",position:{row:1,col:1}}],
  energyBudget:30,allowedCommands:["FORWARD","BACKWARD"],
};
describe("ayuda determinista para reparar con Qwen", () => {
  it("calcula la energía de una ruta real con la paleta completa, sin aceptar la propuesta", () => {
    expect(localRepairHint(mission, {objective:"Sumar costos del camino",grade:2})).toMatchObject({ minimumEnergy:40, allowedCommands:["FORWARD","BACKWARD","TURN_LEFT","TURN_RIGHT"] });
  });
  it("si el docente limita energía no recomienda superar su límite", () => {
    expect(localRepairHint(mission, {objective:"Sumar costos del camino",grade:2,constraints:{maxEnergy:30}})).toMatchObject({ minimumEnergy:40, maxEnergy:30, mustChangeMap:true });
  });
  it("no calcula con propuestas malformadas o sin recorrido", () => {
    expect(localRepairHint({}, {objective:"Sumar costos del camino",grade:2})).toBeUndefined();
    expect(localRepairHint({...mission,grid:{...mission.grid,cells:mission.grid.cells.map(c=>({...c,obstacle:(c.position.row+c.position.col)%2===1}))}}, {objective:"Sumar costos del camino",grade:2})).toBeUndefined();
  });
});
