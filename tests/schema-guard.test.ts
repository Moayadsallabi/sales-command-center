/**
 * The guard that stands between a rubric edit and a dead tracker.
 *
 * A tripwire nobody has seen fire is not a tripwire. These run the real script
 * — once against the live schema, once against the shape that actually took
 * scoring down — and assert on its exit code.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const run = (target?: string) =>
  spawnSync(process.execPath, ["scripts/check-schema.mjs", ...(target ? [target] : [])], {
    cwd: root,
    encoding: "utf8",
  });

describe("the scoring schema guard", () => {
  it("passes the schema currently in the repo", () => {
    const result = run();
    expect(result.status).toBe(0);
  });

  it("refuses the shape that took scoring down on 2026-08-18", () => {
    // Lead factors as a union of labelled strings — the v1.5.0 shape. The API
    // answered 400 for every call until it was rewritten as bare numbers.
    const result = run("tests/fixtures/oversized-schema.json");
    expect(result.status).toBe(1);
    // Refusals go to stderr so a CI log shows them without --verbose.
    expect(result.stderr).toContain("FAIL");
    expect(result.stderr).toContain("enum members");
  });

  it("explains what to do rather than only refusing", () => {
    const result = run("tests/fixtures/oversized-schema.json");
    expect(result.stderr).toContain("bare numbers");
  });
});
