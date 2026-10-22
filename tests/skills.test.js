import test from "node:test";
import assert from "node:assert/strict";
import { ALL_SKILLS, INITIATIVE_SKILLS, SKILL_GROUPS } from "../src/skills.js";

test("the ficha and initiative share the same 22 skills", () => {
  assert.equal(ALL_SKILLS.length, 22);
  assert.equal(INITIATIVE_SKILLS.length, 22);
  assert.equal(new Set(ALL_SKILLS.map((skill) => skill.id)).size, 22);
  assert.deepEqual(
    INITIATIVE_SKILLS,
    ALL_SKILLS.map(({ id, name }) => ({ id, name })),
  );
  assert.equal(SKILL_GROUPS.flatMap((group) => group.skills).length, 22);
});

test("offline standalone sheet keeps the same skill identifiers and labels", async () => {
  const { readFile } = await import("node:fs/promises");
  const runtime = await readFile(new URL("../src/standalone-runtime.js", import.meta.url), "utf8");
  for (const skill of ALL_SKILLS) {
    assert.ok(runtime.includes(`{ id: "${skill.id}", name: "${skill.name}" }`), `${skill.id} should stay synchronized with the offline sheet`);
  }
});
