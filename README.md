# Sales Command Center

A live dashboard for sales calls, covering both halves of the job: what the numbers
say, and why the calls went that way.

- **Commercial** — close rate, cash collected, revenue, and what was booked against
  what was recorded.
- **Per closer** — a leaderboard of every closer's calls, close rate, cash, average
  call score and average lead quality, plus the dimension each one is weakest on.
- **Per call** — an eight-dimension scorecard with the pivotal moment of the call and
  one drill to run on the next one.
- **Per lead** — eight factors scoring the prospect rather than the closer, so a
  middling call can be traced to the right cause.

Every call is scored automatically by the n8n workflow in [`automation/`](automation/),
against the rubric in [`rubric/`](rubric/).

## Two scores, not one

The eight dimensions say how well the call was run. The eight lead factors say what
the closer was handed — pain, urgency, desire, belief in the method, self-belief,
authority, money and fit, out of 100.

Without both, a 5/10 is unattributable. It could be a closer who fumbled a good
prospect, or a closer who did fine with someone who was never going to buy, and those
want opposite fixes. Two closers can only be compared once you can see whether they
were fed the same quality of lead — which is why lead quality sits next to close rate
on the leaderboard rather than on a page of its own.

Each factor maps to one of the seven buying beliefs the closer is scored against, so
the two halves are read in the same language: a lead that arrived weak on Money, and
a closer who never built the Money belief, are the same sentence from both ends.

**What people push back on** counts every objection voiced across the window and what
the close rate does when each one appears. An objection on most calls is being made
upstream — by the price, the pitch or the targeting — and drilling closers on handling
it treats the symptom.

**Quotes carry their timestamp.** Every quote in the written feedback ends with a
`[mm:ss]`, rendered as a link straight into the recording at that moment. It is what
makes a score arguable instead of asserted: a closer who disputes a 4 on Tension can
click and hear the nine seconds in question.

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
| `CALENDLY_API_KEY` | Optional. Adds the booking side of the funnel. See [Bookings](#bookings) |
| `CALENDLY_EVENT_TYPES` | Optional but strongly advised when Calendly is connected. Which event types are sales calls |
| `NEXT_PUBLIC_BRAND_NAME` | The client's business name. Titles the header and names the footer. Unset, the header falls back to "Sales Command Center" and the footer to "Sales Analytics" |
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

## Bookings

Optional, and off until you set `CALENDLY_API_KEY`. Full setup in
[`docs/calendly.md`](docs/calendly.md).

Everything above is built on recordings, which means it can only describe calls
that happened. A prospect who cancels the night before, or books and never turns
up, produces no recording — so a show rate measured here divides recordings by
recordings and reads higher than the real one by however many of those there
were.

Connecting Calendly supplies the denominator. It adds what was booked against
what was held, how many cancellations came from your own side rather than the
prospect, how many landed inside the last day, the utm source on the booking
link, and the prospect's booking-form answers on each call's scorecard.

A booking with no recording is never called a no-show. It is counted in the open
as unaccounted for — "nobody turned up" and "nobody recorded it" need opposite
fixes. There is deliberately no show-rate figure anywhere: while most of the
calendar produces neither a recording nor a cancellation, the honest answer is a
range tens of points wide, and the width of that range is the unaccounted-for
count already on the panel.

```bash
npm run check:calendly
```

## Filling in the missing addresses

`Prospect Email` is the key every join runs on — the booking behind a call, the
payment that followed it, the ad that produced the lead. The workflow takes it
from the calendar invite, and most invites do not carry the prospect as an
addressable attendee, so on a live account the column arrives empty on more rows
than not. Every join on those rows silently fails.

Calendly already holds the address, because the prospect typed it to book.

```bash
npm run backfill:emails            # what it would write
npm run backfill:emails -- --apply # write it
```

It runs the dashboard's own matcher — not a copy of it — and then asks a second
source before writing anything. Those rows have no email precisely because the
invite was thin, so the matcher had to fall back to the prospect's name and the
day, and on a calendar taking twenty bookings a day a first name is not proof.
Fathom settles it: the recording carries the scheduled start time of the
calendar event it recorded, Calendly carries the scheduled start of the event it
created, and if those are the same moment then the booking and the recording are
the same appointment whatever the names looked like.

That same timestamp does one more job. The matcher refuses to choose when two
bookings fit one call, which is right for the funnel — a prospect who booked
twice has one booking kept and one not, and guessing which invents a number. For
an address it usually does not matter, because both bookings are the same
person; where it does, the recording's slot says which booking was the one that
happened.

Anything the two sources disagree about is named and left alone rather than
written and hoped about — a wrong address attaches somebody else's money to the
call, which is worse than a blank. A row that already has an email is never
touched. Notion's page history is the undo.

Set `FATHOM_API_KEY`, or one `FATHOM_KEY_<name>` per closer in `.env.local`, to
get the second opinion; without one the run says so and writes nothing unless
`--unverified` is passed.

## Checking how right it is

A closer's own tracking sheet is usually the most complete record of what
happened on a set of calls. [`npm run check:accuracy`](docs/accuracy.md) grades
the dashboard against one: how many calls it found, how many it committed to an
answer on, and how many of those it got right — by name, so the wrong ones can
be looked at.

It exists so that a change to the matching produces a number rather than an
opinion. It also flags calls the closer recorded that never reached the tracker
at all, which are missing from every figure on the dashboard rather than just
this one.

## Checking it against the money

The tracker records what a call looked like when it ended. Payments do not stop
there — a prospect marked BAMFAM on Tuesday pays on Friday, and nothing goes
back to change Tuesday's row. Left alone, every one of those is a close the
dashboard reports as a loss.

```bash
npm run check:payments
```

Reads the payment processor and names the disagreements: rows that took money
but are not marked Customer, customer rows whose cash figure does not match what
was banked, rows whose money was **refunded**, and buyers with no call on the
tracker at all.

A refund is a reversed payment, not a smaller one, so a row whose money came
back is named and — on `--apply` — marked REFUND with its cash cleared, which
is the outcome the dashboard already keeps out of both cash and revenue. Without
that, a refunded customer reads as one who simply never paid. The first two are a
person's editing list. The third is the coverage gap — calls that never reached
the tracker — and is the number to watch when judging whether the dashboard's
revenue can be read as the business's revenue.

Needs `WHOP_API_KEY` in `.env.local`, with the `payment:basic:read` permission.
Rows without a prospect email fall back to matching on name; anything matched
that way is labelled, because a wrong guess would send someone to edit the wrong
prospect's row.

## Who still owes money

**Payments to collect**, in the Act band under the follow-up list. The money
view has always shown what is outstanding as a total, and a total is not a job:
the second half of a split deal reads as a slightly smaller Cash collected and
never as a person to ring. This panel is the same money as a worklist — who,
how much, and how long since anything arrived from them.

**It is ordered by silence, not by lateness, because the tracker holds no due
date.** There is no column for when the next payment falls due, and a plan
agreed out loud on a call usually has no such date written down anywhere.
Assuming one — thirty days, or the price divided by the number of payments —
would put a deadline on screen that nobody agreed to and chase customers who
are paying to schedule. So each row shows how long since money last arrived;
over 30 days is worth a message and over 60 is worth worrying about, and the
panel says out loud that both are judgement.

**A refund is not a debt, and it is the one that would have cost somebody a
phone call.** The processor's total is net of refunds, so a customer who paid
$2,000 in full and was refunded $1,667 arrives having "paid $333" — and against
a $2,000 deal that reads as $1,667 outstanding. Live on 2026-09-04 exactly one
row on this account was of that shape, with a name and a closer beside it.
Those come off the list and are counted underneath instead: the row needs
marking REFUND on the tracker, not ringing.

**Every row says what ties it to the money**, because a third of them rest on
something weaker than an address:

| | What it means |
|---|---|
| *(no note)* | A payment was tied to this call by the prospect's email. The strongest tie the system makes. |
| matched on name | The address on the row matched no buyer, so this rests on the name alone. A lone wrong answer looks exactly like a confident right one. |
| no payment found | The row has an address and the processor has nothing against it. Either they have not paid, or they paid under another address — the figure shown is the closer's typing. |
| no email on the row | Nothing could be looked up. This is the shape a duplicated row takes: two Customer rows for one person three days apart, one without an address, and the second reads as a customer who never paid. |

The count of those travels in the subtitle rather than only on the rows — a
caveat in small grey type under an amount is read after somebody has already
decided to ring. Where the tracker's own cash figure disagrees with the
processor by more than $50, the row prints both.

With no processor connected — no key, a currency Whop does not settle in, or a
failed read — every figure is the tracker's, and the panel says that once at the
top instead of putting "no payment found" against every row. That claims a
search nobody ran.

**Wins carrying no price** cannot appear at any amount, because nothing can say
what is left of a deal whose size was never recorded. They are counted too.

Like the follow-up list above it, the date range at the top of the page does not
apply — a balance does not stop being owed when the filter moves, and unlike a
follow-up it does not expire at the end of the month either.

## Access control

[`src/proxy.ts`](src/proxy.ts) puts HTTP basic auth in front of every route, and
it is **closed unless you configure it**. With `DASHBOARD_PASSWORD` unset the
dashboard returns a 503 explaining itself rather than serving, because the page
renders prospect names, deal sizes, recording links and what was said on private
sales calls — the state you get by forgetting a variable should not be the one
that publishes all of that.

Set `DASHBOARD_PASSWORD` (and optionally `DASHBOARD_USER`, default `admin`) to
require a login. To publish it with no login on purpose — a demo, a screen on a
wall — leave the password blank and set `DASHBOARD_PUBLIC=1`. Demo mode
(`DASHBOARD_DEMO_DATA=1`) serves without either, since nothing on the page is
real.

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

1. **Checks the meeting title** against the client's sales-call rule: blocked
   phrases first, then the sales phrases. Blocks win, because "Funded Blueprint
   Onboarding Call" contains "Funded Blueprint" and a post-sale call scored as a
   sale inflates the close rate. A title matching neither is not guessed at — it
   goes to Slack for a person, with a link to the form below.
2. **Checks for a duplicate** by looking the recording's `Recording ID` up in
   Notion, so a webhook redelivery or manual re-run never writes a second row.
3. **Checks there is a transcript.** Under 50 words, the call is logged as a
   `No show` with no scorecard instead of being scored on nothing.
4. **Scores the call** against the rubric and writes the full row, including the
   rubric version that produced the scores.

Anything that reads that first rule — `check:delivery`, `backfill:fathom`, the
tests — reads it out of the client's generated workflow through
`scripts/lib/sales-call-filter.mjs`. Nothing restates it. A second copy agrees
until the day it does not: when the rule became one expression on 18 August 2026,
`backfill:fathom` was still reading the old shape and refused to run at all.

## Rescuing a call the tracker refused

Google names an ad-hoc call "Impromptu Google Meet Meeting". It carries no
evidence of what kind of call it was, so the tracker will not score it — and an
alert with no action next to it gets read and left. The form is that action:

```bash
npm run configure:score-form -- --client brey --name "Brey" \
  --closer Christian --closer Tpan
```

writes `automation/generated/score-this-call-<client>.json`. Import it, attach
**one Fathom credential per "Ask Fathom - …" node** (HTTP Header Auth,
`X-Api-Key`), and switch it on. It lives at `/form/score-call-<client>`, which
is the link the untracked-call alert already carries.

Paste a recording id or a Fathom share link, and the same meeting is re-posted
to the tracker's own webhook with `force_score` set — so it goes through the
identical dedupe, scoring and Notion write as a call that arrived on its own.
Nothing is scored twice, and nothing is scored here.

Two things worth knowing:

- **One node per closer is not padding.** A Fathom key reaches its owner's
  recordings and nothing else. A closer with no node is a closer whose calls the
  form can never find, and it will say "could not find that recording" about a
  call sitting in plain sight. The not-found message names how many recordings
  each account returned, so an empty account reads as an empty account.
- **`force_score` never beats an exclusion.** A person vouching for a call is
  not a reason to file an onboarding call as a sale, so the blocks are checked
  first. `configure:client` asserts both halves by running them.

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

### Addresses

Because a deployment *is* a client, so is an address. Each client's service gets
its own subdomain, named **`sales-<client>.perceptionismlab.com`** — product
first so every Command Center sorts together in DNS and in Railway, beside
`kpi.` (the KPI dashboard, which is genuinely multi-client and needs only one
address) and `calendar.` (the Content OS).

    sales-brey.perceptionismlab.com     →  Brey's service
    sales-karan.perceptionismlab.com    →  Karan's service

A bare `sales.` is the one name not to use. It reads as "the Command Center"
when there is no such thing — there is one per client — so whoever opens it
finds a login that will not accept the password they were given, with nothing on
the page to explain why.

Adding one: Railway → the client's service → Settings → Networking → Custom
Domain, then a CNAME in Squarespace DNS with Host `sales-<client>` and the target
Railway gives back. Railway issues the certificate itself. A service can hold
several domains at once, so an address can be moved by adding the new one,
checking it, and then removing the old — no downtime and no window where neither
works.

Nothing in the app reads its own hostname, so there is nothing to change in the
code or the variables when an address is added or moved.

### The scheduled check

`npm run check:scheduled` runs the payments reconciliation, the delivery
checks and the identification check, and posts one plain-English summary to
Slack. It is meant to run on a schedule, not by hand.

**Identification** is the newest of them, and the only one measuring a habit
rather than the software. `Prospect Email` is the key every join runs on, and
the workflow can only take it from an external guest on the calendar invite —
so a call booked without the prospect on it arrives tied to nothing, silently.
Nothing errors; the joins just do not happen, and the dashboard shows revenue
with no call beside calls with no revenue. On Brey's account it went from none
missing in June to 35% of August, which is a booking-process change rather than
drift. `npm run check:identified` reports it on its own, over the last fourteen
days — a rolling window, because a lifetime figure is dragged down by rows that
predate any fix and would read "no better" while the habit was working.

It does **not** run `check:accuracy`. That one grades the matcher against a
closer's tracking sheet the repo cannot ship — and against a frozen answer key,
so it measures a code change rather than a week. [docs/accuracy.md](docs/accuracy.md)
says when to run it.

**It runs daily and speaks conditionally.** Money moves daily: a payment landing
on a Tuesday leaves the tracker wrong until the next run, so anyone reading
revenue mid-week reads a stale number. But posting the same nine unfixed rows
every morning is how a channel gets muted, and a muted alert is silence you have
paid for. So:

| Situation | What happens |
|---|---|
| Something new needs correcting | Posts |
| The same things still need correcting | Silent |
| Everything has been cleared | Posts once, then silent |
| Nothing has changed for 7 days | Posts the weekly all-clear anyway |
| The check itself could not run | Posts — a broken check must not look like a clean one |

The last row is the point of the whole arrangement. A check that only speaks when
it finds something is indistinguishable from a check that has stopped running.

Only the `✗` lines — rows a person can correct — decide whether to post. The `⚠`
lines (the coverage gap, buyers with no call) move whenever anything is sold, so
counting them would make every day look like news and the daily post
unconditional again. They still ride along in whatever gets sent.

#### On Railway

Add a **second service from this same repo** in the same project:

| Setting | Value |
|---|---|
| Source | this repo |
| Start command | `npm run check:scheduled` |
| Cron schedule | `0 10 * * *` (every day, 10:00 UTC) |
| Volume | mount at `/data` — see below |
| Variables | the same `NOTION_*`, `WHOP_API_KEY` and `CALENDLY_*` as the client's service, plus `OPS_ALERT_WEBHOOK` |

**The volume is what makes it quiet.** Every scheduled run is a fresh container
with a fresh filesystem, so without somewhere persistent to keep the last run's
fingerprint there is no memory and every run reports. That is the old behaviour —
noisy, but it never silently swallows a finding, which is why the missing volume
degrades rather than breaks. The run says so in its log when it cannot write.

| Variable | Purpose |
|---|---|
| `OPS_ALERT_WEBHOOK` | Where the summary is posted. Unset means it prints the report instead of sending it, which is what makes it runnable by hand |
| `WEEKLY_CHECK_CLIENT` | Name in the message heading. Defaults to `NEXT_PUBLIC_BRAND_NAME` |
| `STATE_DIR` | Where the fingerprint is kept. Defaults to `/data` |
| `ALWAYS_REPORT` | Set to `1` to skip the change detection and post every run |

**It never writes to Notion.** `check-payments` can apply its corrections with
`--apply`, and that is deliberately not what the schedule runs. Its own header
says the correction cannot be automated: only a person knows whether a payment
is the deal closing, a deposit on a follow-up, or a second instalment on a deal
already counted. The schedule finds the rows and names the command; the
judgement stays with a person.

`npm run check:weekly` still works and runs the same thing, so an existing
schedule configured under the old name keeps working.

## Project layout

```
rubric/rubric.json                        the scoring rubric — the one file to edit
automation/*.template.json                n8n workflow wiring
automation/sales-call-tracker.json        generated; import this into n8n
automation/score-this-call.template.json  the form that rescues an untracked call
automation/generated/                     per-client workflows — import these
automation/error-alert.json               error workflow — alerts when a run fails
scripts/lib/sales-call-filter.mjs         the one reader of the sales-call rule
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
