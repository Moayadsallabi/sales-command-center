/**
 * Reads .env.local, then .env, into process.env — FOR SCRIPTS ONLY.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * It lived in notion-env.mjs beside NOTION_VERSION and notionHeaders, which
 * the WEB APP shares: src/lib/whop.ts imports readPayment from live-read.mjs,
 * which imports NOTION_VERSION from there. Sharing that is deliberate and
 * right — one implementation of a rule, read by both the app and the check
 * scripts, is the thing this codebase keeps choosing.
 *
 * But an ESM import takes the whole module, so the app was pulling in the
 * readFileSync below as well. Its path is a plain variable, so Turbopack
 * cannot tell what it might read, and its answer is to trace the ENTIRE
 * PROJECT into the deployed server bundle:
 *
 *   Warning: Dynamic filesystem access causes tracing of the whole project
 *   ./scripts/lib/notion-env.mjs:48
 *
 * A build warning is the small half. The real one is that script-only code
 * that reads files off disk was being deployed inside the web server, and the
 * files it swept in included .env.local and AGENTS.md.
 *
 * Next.js loads .env files itself, so the app never wanted this function. The
 * scripts do: they run under plain `node`, which does not.
 *
 * NOTHING IN src/ MAY IMPORT THIS FILE. If the app ever appears to need it,
 * the answer is that Next has already done it.
 */
import { readFileSync } from "node:fs";

/**
 * Anything already set in the real environment WINS -- that is what lets a CI
 * run or a one-off `NOTION_DATABASE_ID=... npm run check:notion` override the
 * file without editing it.
 */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  }
}
