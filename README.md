# Sales Command Center

A live KPI dashboard for sales calls. It reads a Notion database and shows close
rate, cash collected, average deal size, show rate, calls over time, and
breakdowns by outcome, offer tier, lead source and call quality.

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

`Name` (title), `Call Date` (date), `Outcome`, `Tier`, `Payment Structure`,
`Lead Source` (select), `Price Discussed`, `Price Closed`, `Cash Collected`,
`Quality Score`, `Duration (min)` (number), `Prospect Revenue`, `Niche`,
`Location`, `Summary` (rich text), `Recording URL` (url).

Columns the dashboard does not recognise are ignored, and a missing column reads
as empty rather than breaking the page. Renaming a column in Notion means
updating `src/lib/notion.ts` to match.

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

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel, import the repo.
3. Add the same environment variables under Settings → Environment Variables.
4. Deploy.

`.env.local` is gitignored and never leaves your machine. The Notion secret is
only ever read server-side.

## Project layout

```
src/app/page.tsx                          server component, fetches from Notion
src/proxy.ts                              optional basic auth over every route
src/lib/notion.ts                         Notion query + property mapping
src/lib/types.ts                          CallRecord shape
src/components/dashboard/                 KPI cards, charts, call table
src/components/dashboard/setup-notice.tsx connection-failure screen
src/components/ui/                        shadcn primitives
scripts/check-notion.mjs                  pre-flight connection check
```
