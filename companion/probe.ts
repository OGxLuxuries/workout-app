import { Codex } from "./codex.js";
const codex = new Codex();
try {
  console.log("Starting Codex handshake…");
  await codex.init();
  console.log("Listing connected apps…");
  const app = await codex.hevy();
  console.log("Hevy discovered in independent Codex process:", app.id);
  const result = await codex.run(
    app,
    "Read the connected Hevy user preferences and page 1 of their workouts with pageSize 1. Return the source user id, workout count returned, and whether the actual workout contains an id and updated_at. Do not return notes, descriptions, or personal details. Use only actual Hevy read tools. If unavailable, return ok false.",
    {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        sourceUserId: { type: ["string", "null"] },
        workoutCount: { type: "integer" },
        hasRequiredFields: { type: "boolean" },
      },
      required: ["ok", "sourceUserId", "workoutCount", "hasRequiredFields"],
      additionalProperties: false,
    },
  );
  const r = result as any;
  console.log(
    JSON.stringify({
      ok: r.ok,
      workoutCount: r.workoutCount,
      hasRequiredFields: r.hasRequiredFields,
      sourceIdentityPresent: !!r.sourceUserId,
    }),
  );
  if (!r.ok) process.exitCode = 1;
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  codex.close();
}
