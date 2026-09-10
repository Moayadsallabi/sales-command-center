/**
 * The two things every check script needs before it can talk to Notion.
 *
 * NOTHING HERE TOUCHES THE FILESYSTEM, and that is now load-bearing rather
 * than incidental: the web app shares this module (src/lib/whop.ts ->
 * live-read.mjs -> NOTION_VERSION), and a file read with a non-static path
 * makes Turbopack trace the whole project into the deployed server bundle.
 * loadEnv used to live here and moved to env-file.mjs for exactly that
 * reason -- see the note at the top of that file before adding anything
 * here that reads from disk.
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
