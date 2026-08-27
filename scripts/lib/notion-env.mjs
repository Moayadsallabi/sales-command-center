/**
 * The two things every check script needs before it can talk to Notion.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `loadEnv` was copied byte-for-byte into seven scripts, and the Notion API
 * version was typed out in nine places across eight files. Neither had drifted
 * yet, which is the only reason it was cheap to fix: the failure mode is that
 * Notion moves to a new version, someone updates eight of the nine, and the
 * ninth script keeps working against the old one until the day it does not.
 *
 * One fact, one place -- the same rule the dashboard already applies to every
 * number it puts on screen.
 */
import { readFileSync } from "node:fs";

/**
 * The Notion API version every script and the app itself quote.
 *
 * Notion pins behaviour to this string, so changing it is a deliberate act
 * with a changelog to read first -- not something to bump because it looks old.
 * src/lib/notion.ts carries its own copy, because the app and these scripts
 * are built separately and a .mjs import would not survive the bundler.
 */
export const NOTION_VERSION = "2022-06-28";

/** The headers a Notion request needs, given the integration secret. */
export function notionHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/**
 * Reads .env.local, then .env, into process.env.
 *
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
