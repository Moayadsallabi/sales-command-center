/**
 * A check that could not run is neither a pass nor a finding.
 *
 * The fault these pin happened on 2026-09-08, when three of the six scheduled
 * checks had never run once on the server and the daily report said so three
 * different ways — one honest but causeless, one silent, and one that published
 * a false alarm about a client's money every morning for weeks.
 *
 * scripts/lib/required-env.mjs carries the full account. These tests hold the
 * two properties that would have caught it: an exit code means exactly one
 * thing, and a check the report runs has to have declared what it needs.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  REQUIREMENTS,
  missingFor,
  outcomeOf,
  NOT_CONFIGURED,
  CLEAN,
  FINDING,
  BROKE,
  UNCONFIGURED,
} from "../scripts/lib/required-env.mjs";
import { handleFrom, workflowPathFor } from "../scripts/lib/sales-call-filter.mjs";

const SCRIPTS = join(process.cwd(), "scripts");

describe("what an exit code means", () => {
  it("separates the four outcomes rather than folding them into pass and fail", () => {
    expect(outcomeOf(0)).toBe(CLEAN);
    expect(outcomeOf(1)).toBe(FINDING);
    expect(outcomeOf(2)).toBe(BROKE);
    expect(outcomeOf(NOT_CONFIGURED)).toBe(UNCONFIGURED);
  });

  it("never reports a check that did not run as one that found something", () => {
    // This is the exact collapse that put "a claim that money was missing no
    // longer holds" in front of a client daily, on the strength of an exit code
    // that meant "I could not read my credentials".
    for (const code of [2, NOT_CONFIGURED, 4, 127]) {
      expect(outcomeOf(code)).not.toBe(FINDING);
      expect(outcomeOf(code)).not.toBe(CLEAN);
    }
  });

  it("keeps 'not configured' distinct from 'broke', because only one of them retries away", () => {
    expect(outcomeOf(NOT_CONFIGURED)).not.toBe(outcomeOf(2));
  });
});

describe("what this environment is missing", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  const clear = () => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("FATHOM_KEY_") || k.startsWith("NOTION_") || k === "WHOP_API_KEY") {
        delete process.env[k];
      }
    }
  };

  it("names every absent variable, not just the first", () => {
    clear();
    expect(missingFor("check-payments.mjs")).toEqual([
      "NOTION_API_KEY",
      "NOTION_DATABASE_ID",
      "WHOP_API_KEY",
    ]);
  });

  it("is satisfied by ANY one key in a family, because closers are added over time", () => {
    clear();
    process.env.NOTION_API_KEY = "x";
    process.env.NOTION_DATABASE_ID = "x";
    process.env.FATHOM_KEY_TPAN = "x";
    expect(missingFor("check-delivery.mjs")).toEqual([]);
  });

  it("reports the family as missing when it is empty — the fault of 2026-09-08", () => {
    clear();
    process.env.NOTION_API_KEY = "x";
    process.env.NOTION_DATABASE_ID = "x";
    expect(missingFor("check-delivery.mjs")).toEqual(["FATHOM_KEY_<closer>  (at least one)"]);
  });

  it("does not count a variable that is present but empty", () => {
    clear();
    process.env.NOTION_API_KEY = "";
    process.env.NOTION_DATABASE_ID = "x";
    expect(missingFor("check-identified.mjs")).toContain("NOTION_API_KEY");
  });

  it("refuses to answer for a check nobody declared, rather than saying it is fine", () => {
    expect(() => missingFor("check-invented.mjs")).toThrow(/no environment requirement/i);
  });
});

describe("the declaration cannot drift from what actually runs", () => {
  const weekly = readFileSync(join(SCRIPTS, "weekly-checks.mjs"), "utf8");

  it("declares a requirement for every check the scheduled report spawns", () => {
    const spawned = [...weekly.matchAll(/runScript\(\s*"([\w-]+\.mjs)"/g)].map((m) => m[1]);
    expect(spawned.length).toBeGreaterThan(0);
    for (const file of spawned) {
      expect(Object.keys(REQUIREMENTS)).toContain(file);
    }
  });

  it("preflights the same list it spawns, so the top of the report matches the body", () => {
    const spawned = new Set([...weekly.matchAll(/runScript\(\s*"([\w-]+\.mjs)"/g)].map((m) => m[1]));
    const declared = new Set(
      [...weekly.matchAll(/^\s+"(check-[\w-]+\.mjs)",$/gm)].map((m) => m[1])
    );
    expect([...spawned].sort()).toEqual([...declared].sort());
  });
});

describe("every section of the report can say 'this did not run'", () => {
  // The three sections got this wrong in three different ways on the same
  // morning, so the guard is structural rather than one test per section: any
  // function that renders a check's exit code has to have an opinion about the
  // code that means "not configured". Without this, the next section somebody
  // adds inherits the original bug by default.
  const weekly = readFileSync(join(SCRIPTS, "weekly-checks.mjs"), "utf8");
  const sections = [...weekly.matchAll(/function (\w+Section)\s*\(([^)]*)\)/g)]
    .map((m) => ({ name: m[1], args: m[2] }))
    // configurationSection IS the not-configured report; it takes no exit code.
    .filter((f) => /code|delivery|dropped/.test(f.args));

  it("finds the sections it means to check", () => {
    expect(sections.map((f) => f.name).sort()).toEqual([
      "arrivalSection",
      "collectSection",
      "identifiedSection",
      "paymentsSection",
    ]);
  });

  it.each(sections.map((f) => f.name))("%s handles a check that was not configured", (name) => {
    const start = weekly.indexOf(`function ${name}(`);
    const body = weekly.slice(start, weekly.indexOf("\n}", start));
    expect(body).toMatch(/NOT_CONFIGURED|UNCONFIGURED/);
  });
});

describe("a display name is not a handle", () => {
  // The scheduled report carried one variable for two jobs: titling the Slack
  // message and finding this client's generated workflow. Set to "Brey" it
  // asked for sales-call-tracker-Brey.json, which exists on a Mac (case is
  // ignored) and does not exist on the Linux container it runs on.
  it("lower-cases a display name into the handle the files are named by", () => {
    expect(handleFrom("Brey")).toBe("brey");
  });

  it("turns spaces into the separator the filenames use", () => {
    expect(handleFrom("Funded Blueprint")).toBe("funded-blueprint");
    expect(handleFrom("  the tracker  ")).toBe("the-tracker");
  });

  it("leaves a handle that is already one untouched", () => {
    expect(handleFrom("brey")).toBe("brey");
  });

  it("finds the real workflow for the name this deploy is actually set to", () => {
    expect(existsSync(workflowPathFor(handleFrom("Brey")))).toBe(true);
    // And the un-normalised name is what the container could not find. On macOS
    // the filesystem answers this case-insensitively, so the assertion is on the
    // string rather than on the disk — that is the whole reason it went unseen.
    expect(workflowPathFor("Brey")).not.toBe(workflowPathFor(handleFrom("Brey")));
  });

  it("empties rather than inventing a handle from nothing", () => {
    expect(handleFrom(undefined)).toBe("");
    expect(handleFrom("")).toBe("");
  });
});

describe("no check reads .env.local behind the shared loader's back", () => {
  // Two scripts did, and it is why they had never run on a server: a container
  // has the variables and no such file. The loader reads the files AND the real
  // environment; reading the file directly quietly excludes every deploy.
  const files = readdirSync(SCRIPTS).filter((f) => f.startsWith("check-") && f.endsWith(".mjs"));

  it.each(files)("%s", (file) => {
    const src = readFileSync(join(SCRIPTS, file), "utf8");
    expect(src).not.toMatch(/readFileSync\([^)]*\.env\.local/);
  });

  it("checks a real set of files, so an empty glob cannot pass this suite", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });
});
