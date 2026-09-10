/**
 * RUNNING THE DASHBOARD'S OWN CODE FROM A SCRIPT.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCRIPTS COMPILE THE APP AT ALL
 *
 * `backfill-emails`, `backfill-call-dates` and `check-accuracy` each exist to
 * measure or repair what the dashboard does, and each of them says in its own
 * header that it runs the dashboard's own reader "rather than a second copy
 * that would drift from it". That is the whole point of them: a check written
 * against a re-implementation checks the re-implementation.
 *
 * The app's sources import without file extensions, which only a bundler
 * resolves, so they are transpiled to CommonJS in a temp folder and required
 * from there.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE FUNCTION AND NOT THREE COPIES OF TWENTY LINES
 *
 * It was three copies, and on 2026-09-10 all three broke at once. `bookings.ts`
 * and `notion.ts` gained an import of `scripts/lib/business-day.mjs` — the
 * shared rule for which calendar day a booking or a call belongs to — and with
 * `--rootDir src/lib` the emitted files sit flat in the temp folder, so
 * `../../scripts/lib/business-day.mjs` resolved to a path two levels above the
 * system temp directory. Every one of the three failed with MODULE_NOT_FOUND,
 * including the one whose whole job is filling in the addresses those joins
 * need.
 *
 * So the layout is mirrored instead of flattened — `--rootDir .`, and the plain
 * .mjs modules copied in beside the compiled output — and the fix lives once.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Compile the named `src/lib` modules and hand back a loader for them.
 *
 * @param entries e.g. ["src/lib/notion.ts"] — paths from the repo root
 * @param label   goes in the temp folder name, so a stray one says whose it was
 * @returns `{ load, cleanup, dir }` — `load("notion.js")` returns the module
 *
 * Throws on a compile failure with the compiler's own output attached, so the
 * caller can print it: "the app did not compile" with no reason is a message
 * that sends someone to the wrong place.
 */
export function compileAppLibs(entries, label) {
  const dir = mkdtempSync(join(tmpdir(), `scc-${label}-`));
  try {
    execFileSync(
      "npx",
      [
        "tsc",
        ...entries,
        "--outDir",
        dir,
        // THE REPO ROOT, so `src/lib/x.js` lands at `<dir>/src/lib/x.js` and a
        // relative import reaching out of src/lib still resolves. Pinned rather
        // than inferred from the entry list, which is what makes the output
        // layout predictable enough for `load` below to name.
        "--rootDir",
        ".",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--target",
        "es2022",
        "--esModuleInterop",
        "--skipLibCheck",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    const detail = String(err.stderr ?? err);
    const wrapped = new Error("The app's own code did not compile.");
    wrapped.detail = detail;
    throw wrapped;
  }

  // The plain .mjs modules the compiled code imports — the shared rules that
  // are deliberately NOT TypeScript so these scripts can use them too. tsc does
  // not emit them, so they are copied in with their path preserved.
  cpSync("scripts/lib", join(dir, "scripts", "lib"), {
    recursive: true,
    filter: (src) => !src.endsWith(".d.mts"),
  });

  const require = createRequire(import.meta.url);
  return {
    dir,
    /** `load("notion.js")` — named relative to `src/lib`. */
    load: (file) => require(join(dir, "src", "lib", file)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
