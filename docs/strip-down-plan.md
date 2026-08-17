# Strip-down plan — proposal, not yet agreed

Written 2026-08-17, after measuring the dashboard against a real fortnight of
Brey's calls. Moayad to rule on the open questions at the bottom before any of
this is built.

## Why

`npm run check:accuracy`, run against 48 real calls from 1–16 August:

```
  on the calendar     29 of 48   60%
  in the tracker      32 of 48   67%
  answered            21 of 48   44%
  ├─ correct          18        86% of what we answered
  no booking          19        — not on this Calendly at all
```

The dashboard can speak to 44% of the calls that happened. When it does speak it
is right 86% of the time.

The gap is not the code. Nineteen calls were never booked through Calendly, six
different names exist for the same event type, 37% of bookings cancel, and no
booking link carries a tag. Building more features moves none of those numbers.

## The principle

The test for keeping something is not "is this interesting". It is:

> **Where does this number actually come from?**

Two kinds of number live on the dashboard.

**Heard on the call.** How it was run, how good the lead was, what they pushed
back on, where it turned. Nothing else in the world produces these. They need
only a recording, they need no setup, and they are right about 90% of the time.

**A fact of record kept somewhere else.** Money in, where the lead came from,
whether they turned up. The scorer is guessing these from what people said out
loud, and a system that knows them properly already exists.

Everything painful is in the second group. Currency, tiers, FX rates, refunds,
deposits, lead source — every one.

**So the Command Center stops being a revenue dashboard.** Cash already has a
home: the KPI dashboard reads real Whop payments and traces real ads to real
buyers. Today both systems answer "how much money" and disagree about currency.
One of them should stop.

This one answers what nothing else can: **how well are the calls being run, and
what quality of lead are we handing people?**

## What gets deleted

### Notion columns — 50 today, 38 after

| Column | Why it goes |
| --- | --- |
| `Tier` | A price band is money. Guessed from speech, and only has two slots when Brey sells three |
| `Payment Structure` | Never displayed anywhere |
| `Lead Source` | Guessed from a transcript that never says it. The KPI dashboard traces it properly |
| `Price Discussed` | Never displayed anywhere |
| `Collected On Call` | Money. Belongs to Whop |
| `Cash Collected` | Money, and hand-typed. Belongs to Whop |
| `Outstanding` | Money, and hand-typed. Belongs to Whop |
| `Currency` | Only existed to make the money columns safe |
| `FX Rate` | Same |
| `Prospect Revenue` | Never displayed anywhere |
| `Location` | Never displayed anywhere |
| `Niche` | Shown in one table column, never grouped or counted by |

`Price Closed` **stays**, with its meaning corrected: the deal agreed on the
call. It is a forecast, not cash, and nothing should label it revenue. Keeping it
also means the KPI dashboard's existing sync does not break.

### Screen furniture

Ten KPI boxes become six: **Booked, Recorded, Show Rate, Calls Taken, Close
Rate, New Customers.** The four money boxes go.

Eleven panels become eight. Deleted: **Revenue Over Time**, **Lead Source
Performance**, **Tier Distribution**.

The closers table loses its **On call** and **Cash** columns.

The call list becomes: Name, Closer, Date, Outcome, Deal size, **Lead quality**,
Score. Lead quality is new there and costs nothing — the number already exists.

### Code

Deleted outright: `revenue-chart.tsx`, `lead-source-chart.tsx`,
`tier-chart.tsx`, and most of `money.ts`.

The scorer stops extracting tier, payment structure, lead source, price
discussed, collected-on-call and currency. It keeps outcome, price closed and
the summary.

## What gets fixed for free

Every one of these disappears with the thing that caused it, at no extra work:

- The dollar sign painted on the revenue graph
- The tier pie chart reading 88% + 13% = 101%
- Deposits taken on a follow-up call vanishing from the totals
- Refunded deals showing cash in the list but not in the totals
- The two dashboards disagreeing about whether a deal is pounds or dollars
- The missing-FX-rate warning banner
- Four columns collected on every call and never shown
- The scorer defaulting an unstated currency to dollars

## What stays

The eight call scores, the eight lead factors, objections, the flags, the
moment, the next-call drill, the per-call scorecard with clickable timestamps.

The closers table, what's costing you, which parts of the call move your close
rate, what the leads are worth, what people push back on.

Show rate and cancellations from the calendar — the calendar is genuinely the
only thing that knows those.

The accuracy checker, which is now the most valuable tool in the repo.

## Setup afterwards

Today: roughly 20 steps across five services. Both installs so far broke on the
same thing — a Notion dropdown with no choices typed into it.

After:

1. **Notion** — duplicate the template, share it with the integration, type the
   closers' names into the Closer dropdown
2. **n8n** — run the configure script, import the file it writes, attach the
   Notion and Anthropic credentials, set the error workflow, switch it on
3. **Fathom** — point the webhook at the n8n address
4. **Hosting** — deploy, set three variables and a password

Calendly stays optional and adds three steps: a token, the event-type names, and
tags on the booking links.

## The part that cannot be automated

This is the honest cost, and it is the client's, not ours. Every client needs:

- **One booking link** for sales calls
- **One name** for that event type, spelled the same way every time
- **One rule** about what the calendar invite is called

Brey currently has six spellings of one event type and 40% of calls booked
outside the link. Until that changes, no version of this reads better than 45%,
however much gets built.

Worth saying on the sales call, not three weeks into a setup.

## Do this before building anything

Fix Brey's two habits — merge the six event-type names into one, and route every
call through that link. Then re-run `npm run check:accuracy`.

If it goes from 44% to 80%, the system is proven and there is a real case study.
If it does not, that is a week spent instead of another month.

## Open questions — Moayad to rule

1. **Does a client who has no KPI dashboard get any money view at all?** If the
   Command Center stops counting cash, a standalone client sees close rate and
   scores but no revenue. Acceptable, or does a minimal money view stay?
2. **Is "The Funded Blueprint Enrollment Call" a sales call?** 47 bookings in 90
   days are currently being ignored. So are five under "THE FUNDED BLUEPRINT
   (STRATEGY SESSION)" and "The Funded Blueprint — Strategy Call".
3. **Does `Tier` really go?** It is the only way to segment a client selling more
   than one offer. Cutting it is right if tiers are a price band; wrong if
   they are different products.
4. **Does deal value stay on the call as a forecast, or leave entirely?** This
   plan keeps it. The alternative is that the call record holds no number at all.

## Effort

Mostly deletion, so roughly half a day, plus regenerating the client pack and
the two client-facing documents — which are a version behind regardless and need
doing either way.
