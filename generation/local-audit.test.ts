import { expect, it } from "vitest";
import { missionFingerprint } from "./local-audit";
it("permite comparar una propuesta aunque cambie el orden de sus claves JSON", () => {
  const expected = "802d809921b03007ca79bdd6938ef87a6e5fdb08d889010fbf4413530526aa5d";
  expect(missionFingerprint({ b: [{ y: 2, x: 1 }], a: "niño" })).toBe(expected);
  expect(missionFingerprint({ a: "niño", b: [{ x: 1, y: 2 }] })).toBe(expected);
  expect(missionFingerprint({ a: "niño", b: [{ x: 1, y: 3 }] })).not.toBe(expected);
});
