# Sales Command Center

A live dashboard for sales calls, covering both halves of the job: what the numbers
say, and why the calls went that way.

- **Commercial** — close rate, cash collected, revenue, show rate, and breakdowns by
  outcome, offer tier and lead source.
- **Per closer** — a leaderboard of every closer's calls, close rate, cash and average
  call score, plus the dimension each one is weakest on.
- **Per call** — an eight-dimension scorecard with the pivotal moment of the call and
  one drill to run on the next one.

Every call is scored automatically by the n8n workflow in [`automation/`](automation/),
against the rubric in [`rubric/`](rubric/).

Nothing is stored here. Every number is read from Notion at request time, so
editing a row in Notion and refreshing the page updates the dashboard.

## Requirements

- Node 20 or newer
- A Notion internal integration with access to your sales tracker database

## Setup

```bash
npm install
cp .env.example .env.local
```

| Variable | What it is |
| --- | --- |
| `NOTION_API_KEY` | The secret of an internal integration created at [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| `NOTION_DATABASE_ID` | The 32-character id in the database URL. Dashes optional |
| `NEXT_PUBLIC_BRAND_NAME` | Optional. Shown in the footer. Defaults to "Sales Analytics" |
| `DASHBOARD_PASSWORD` | Optional. See [Access control](#access-control) |
| `DASHBOARD_USER` | Optional. Defaults to `admin` |
| `DASHBOARD_DEMO_DATA` | Optional. Set to `1` to render invented sample calls instead of reading Notion, so you can see the dashboard before your first real call lands. Leave it unset in any real deployment |

After creating the integration, open the database in Notion and add it under
**••• → Connections** — a token alone does not grant access.

Verify the wiring before starting the app:

```bash
npm run check:notion
```

That checks the token, confirms the integration can see the database, diffs the
database's properties against the ones `src/lib/notion.ts` reads, and reports how
many rows come back.

Then:

```bash
npm run dev
```

Open http://localhost:3000.

## Access control

[`src/proxy.ts`](src/proxy.ts) can put HTTP basic auth in front of every route.
It is **off by default** — with `DASHBOARD_PASSWORD` unset, the dashboard is
public to anyone with the URL, which matters because it renders prospect names,
deal sizes and call summaries.

To require a login, set `DASHBOARD_PASSWORD` (and optionally `DASHBOARD_USER`,
default `admin`) in the environment. Unset it to make the dashboard public again.

Note this is `proxy.ts`, not `middleware.ts` — Next 16 renamed that convention.

## Expected Notion columns

The full list, with types and option values, is in
[`docs/notion-schema.md`](docs/notion-schema.md). `npm run check:notion` verifies your
database against it.

Columns the dashboard does not recognise are ignored, and a missing column reads
as empty rather than breaking the page — so calls recorded before the scorecard
existed still show up, just without scores.

## The scoring rubric

The rubric is written once, in [`rubric/rubric.json`](rubric/rubric.json), and
everything else is generated from it:

```bash
npm run build:rubric
```

| Generated file | What uses it |
| --- | --- |
| `rubric/system-prompt.txt` | The prompt the workflow sends to Claude |
| `rubric/output-schema.json` | Constrains the reply so it always matches the schema |
| `rubric/scorecard-rubric.md` | The readable rubric — share this with your closers |
| `rubric/skill.md` | A Claude chat skill for reviewing a call manually, same rubric |
| `src/lib/dimensions.ts` | The dimension list the dashboard renders |
| `automation/sales-call-tracker.json` | The n8n workflow you import |

Do not hand-edit those six. Edit `rubric/rubric.json` (or
`automation/sales-call-tracker.template.json` for workflow wiring) and re-run the
build. Changing the dimensions also means adding the matching Notion columns.

The chat skill ships with the same `[OFFER CONTEXT]` placeholder as the workflow
prompt. To build a copy with your real offer context, describe the offer in
`rubric/offer-context.local.md` (gitignored) and re-run the build — it writes
`rubric/skill.local.md` (also gitignored), which is the version to install as a
Claude skill.

```bash
npm run check:workflow
```

runs the generated workflow's expressions against a mock Fathom payload, so a broken
expression fails on your machine rather than on a real sales call.

## What the workflow does with a call

Fathom fires the webhook when a transcript is ready. The workflow then:

1. **Checks the meeting title** contains the sales-call keyword (default "Strategy
   Call") — anything else is ignored.
2. **Checks for a duplicate** by looking the recording's `Recording ID` up in
   Notion, so a webhook redelivery or manual re-run never writes a second row.
3. **Checks there is a transcript.** Under 50 words, the call is logged as a
   `No show` with no scorecard instead of being scored on nothing.
4. **Scores the call** against the rubric and writes the full row, including the
   rubric version that produced the scores.

The Claude and Notion calls retry three times on transient failures. For anything
that still fails, import [`automation/error-alert.json`](automation/error-alert.json)
as a second workflow, point its webhook URL at a Slack incoming webhook (or any
endpoint that accepts JSON), and set it as the tracker workflow's error workflow
under **Settings → Error Workflow**. Without it a failed run dies silently — Fathom
already got its 200 and will not retry, so the call would simply never appear.

## Troubleshooting

If the connection to Notion fails, the dashboard shows a setup screen naming the
problem and the fix instead of an error page. The two most common causes:

- **"Notion rejected the API key"** — `NOTION_API_KEY` is wrong, or a `Bearer `
  prefix was pasted in with it. The variable takes the bare secret.
- **"Database not found"** — usually not a wrong id. A Notion database stays
  invisible to an integration until it is shared with it: open the database,
  then ••• → Connections → add your integration.

An empty database is not an error — the dashboard renders zeroed KPIs until the
first call lands.

## Deploying

It's a standard Next.js app with no platform-specific code, so any Node host works.
On Railway (the default here):

1. Push this repo to GitHub.
2. In Railway: New Project → Deploy from GitHub repo → pick this repo.
3. Add the same environment variables on the service's Variables tab.
4. Settings → Networking → Generate Domain to get the public URL.

Hosting more than one client? One Railway service per client, each with its own
`NOTION_API_KEY`, `NOTION_DATABASE_ID` and `DASHBOARD_PASSWORD` — never share a
deployment or a password between clients.

`.env.local` is gitignored and never leaves your machine. The Notion secret is
only ever read server-side.

## Project layout

```
rubric/rubric.json                        the scoring rubric — the one file to edit
automation/*.template.json                n8n workflow wiring
automation/sales-call-tracker.json        generated; import this into n8n
automation/error-alert.json               error workflow — alerts when a run fails
docs/notion-schema.md                     the columns your Notion database needs

src/app/page.tsx                          server component, fetches from Notion
src/proxy.ts                              optional basic auth over every route
src/lib/notion.ts                         Notion query + property mapping
src/lib/types.ts                          CallRecord shape
src/lib/dimensions.ts                     generated from the rubric
src/lib/stats.ts                          per-closer aggregation, pattern detection
src/lib/demo-data.ts                      sample calls for DASHBOARD_DEMO_DATA=1
src/components/dashboard/                 KPI cards, charts, call table
src/components/dashboard/closer-leaderboard.tsx  per-closer table
src/components/dashboard/whats-costing-you.tsx   the dimensions worth acting on
src/components/dashboard/dimension-impact.tsx    close rate when done well vs not
src/components/dashboard/scorecard-panel.tsx     per-call scorecard drawer
src/components/dashboard/setup-notice.tsx connection-failure screen
src/components/ui/                        shadcn primitives
scripts/build-rubric.mjs                  regenerates everything from the rubric
scripts/check-notion.mjs                  pre-flight connection check
scripts/check-workflow.mjs                evaluates the workflow against mock data
```
