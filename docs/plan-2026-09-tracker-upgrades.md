# Plan — the five things to take from the outside trackers

Written 2026-09-04, from the audit in
`reference/sales-tracker-benchmarks/INDEX.md` at the workspace root. Live
figures below were read the same day off Brey's Notion tracker (86 calls since
1 August). Order is by what unblocks what, not by size.

| # | Item | Kind | Who | Depends on |
|---|---|---|---|---|
| 1 | Daily leaderboard in Brey's Slack | Code, KPI dashboard | Claude | A webhook for Brey's team channel |
| 2 | Cash tile split: new, remainder, deposits | Code, Sales Command Center | Claude | Nothing |
| 3 | Setter attribution and booking-source split | Process first, then code | Brey's setters, then Claude | Setter links live and one booking carrying the field |
| 4 | Show rate | Process only | Brey's closers | Nothing |
| 5 | Offer rate | Dropped | — | — |

## What Brey's team is asked for (send this week)

Four asks. Three are one sentence each and none of them is new code.

- **Each setter books through their own link.** Same Calendly event, with the
  setter's name added to the link, e.g. `?utm_source=dm&utm_content=jordan`.
  The plain link stays on the bio and in content, so a booking with nothing on
  it means self-booked. Calendly stores the parameters on the booking, and both
  dashboards already read them off every invitee. Nothing to type afterwards.
- **Closers mark no-shows in Calendly.** The event has a "mark as no-show"
  button. Both dashboards already read that mark and refuse to print a show
  rate until it exists. Today it does not exist on a single booking.
- **An email on every call row** in Notion. 28 of the 86 calls since 1 August
  have none, and every join to the money runs on it. Already on file since
  2026-09-01; item 1 makes the cost of leaving it blank visible to the closer.
- **Ref tags on ads** (Shahrose). Already written up in
  `clients/brey/ad-attribution.md`; listed here because item 3 and that fix
  are the two halves of the same chain.

## 1 · Daily leaderboard in Slack

**What it posts**, once a day in the client's evening, to the team channel:

```
CLOSERS — Thu 4 Sep
1. Tpan A — $4,000 collected · 2 closes
2. Christian Pinto — $0 · 0 closes
Week so far: Tpan $21,500 · Christian $3,000
$5,200 collected today, $4,000 of it tied to a closer. 1 payment had no call on record.
```

Setters get their own two lists as soon as item 3 delivers the field.

**Where the numbers come from.** Whop payments joined to Notion calls by the
prospect's email, which is the join the collect list and the KPI dashboard's
payments tab already use. Cash per closer is the day's payments on calls that
name that closer; closes are Customer rows by call date. The floor and the
refund handling come from `sales-rules.json`, unchanged.

**The caveat line is not optional.** On 2026-09-01, $37,704 of August's cash had
no call behind it. A leaderboard that quietly showed the attributed part would
be reporting less than half the money as if it were all of it. The last line
names the gap every day, which is also what turns the missing-email habit into
the closer's own problem.

**Build.**
- `perceptionismlabkpis`: a new `services/leaderboard.js` that builds the text
  from the client's payments and calls tabs; a cron entry beside the existing
  daily jobs in `src/index.js`; posts through `postToSlack` to the client's
  `slack_webhook` in the registry, so a failed post lands on the sync status
  and `/api/health` like every other feed.
- Posts every day, including a $0 day. Unlike the task line, silence here
  cannot mean "nothing to say": a leaderboard that stops appearing is the only
  signal that the feed died.
- A `--dry-run` script that prints the text for a given day without posting.

**Verify before it goes live.** Print three past days by hand and read each
figure against the Sales Command Center's cash tile and against Whop for the
same day. Per the 2026-09-04 corollary, this output names people, so check the
rows, not the total: every closer's figure traced to its payments.

**Needs from Moayad:** a Slack incoming webhook for Brey's team channel, and
Brey's timezone for the posting hour (the Airtable team posted at 6pm New
York).

## 2 · Split the cash tile

Under **Cash Collected** on the Sales Command Center, three figures and a
sentence:

| Figure | Counts |
|---|---|
| New | payments in the period on deals whose call is also in the period |
| Remainder | payments in the period on deals closed before it |
| Deposits | payments in the period on calls not marked Customer |
| *(sentence)* | payments in the period with no call on record, already worded on the page |

The four must add up to the tile. That identity is the test: a fixture with a
deal closed 31 July and paid 2 August lands in Remainder, and the sum equals
the total or the test fails. It also means the split cannot be built on a
fixture where every payment is New, which is the trap the 2026-08-25 rule
names.

**Build.**
- `src/lib/whop.ts`: each buyer currently carries a paid total and a first and
  last date. The split needs the individual payments with their dates, so
  `WhopBuyer` gains `payments: { day, amount }[]`. Nothing that reads the
  existing fields changes.
- `src/lib/money.ts`: one function taking the period, the calls and the
  buyers, returning the four figures.
- The definition of New and Remainder is a money rule, so it goes into
  `sales-rules.json`, the version bumps, the copy goes to the KPI dashboard
  whole, and `npm run check:rules` passes on both.
- Tile notes in `src/lib/tile-notes.ts` carry the population sentence.

**Verify:** `npm run check:live` for August, then read the four figures
against Whop's own payment list for a week.

## 3 · Setter attribution and booking source

**Wait for the field.** Per the 2026-08-19 rule, a panel that cannot fill is
hidden, so no code lands until at least one live booking arrives carrying a
setter name. `npm run check:calendly` says when that happens.

**Then, on the Sales Command Center:**
- `src/lib/bookings.ts`: a linked booking already carries the UTM fields. Add
  `setter` (the content value) and `booking_source` (dm-set / self-booked /
  unknown, where unknown is a call with no matched booking) to the linked
  call. No new Notion column: derived from Calendly, never typed.
- A setters table beside the closers one: sets, held, closed, cash, with the
  same three-call minimum before a rate prints. Cash per setter is the same
  payment join as item 1, so the two agree by construction.
- One booking-source row: held, show and close per source. Show only appears
  once item 4 is being done.
- Filter chips for setter, reusing the closer chip.

**On the KPI dashboard:** the bookings tab already stores the UTM columns, so
the setter reaches the leaderboard post in item 1 by reading `utm_content` off
the booking that matches the call. Second lists in the Slack post, same
caveat line.

**The test that matters:** a fixture where some calls have no matched booking,
so that the setter figures are asserted against a population smaller than the
closer figures. Equal populations would pass whichever way the code read it.

**Out of scope, stated so it is not relitigated:** per-setter DM activity
(reply time, follow-ups, asked-for-call by setter). The DM sync does not record
which person replied, and nothing in Zernio's payload names one. If that ever
matters, it is a question for Zernio, not a dashboard change.

## 4 · Show rate

No code. The moment closers mark no-shows in Calendly, `show-rate.js` on the
KPI dashboard and the funnel on the Sales Command Center both stop refusing and
print it, with the unaccounted-for count still beside it. Check after a week
with `npm run check:calendly`; if the mark count is still zero, the ask did not
land and the number stays blank on purpose.

## 5 · Offer rate — dropped

Read live on 2026-09-04: of 86 calls since 1 August, 8 were no-shows and 5 were
"No offer made", so an offer was made on 73 of 78 held calls, or 94%. The
column is real, which was the question, and the answer is a number that would
change nothing anyone does. It stays out under the earn-its-place rule.

## Order of work

1. Send the four asks to Brey's team. Same message, one day.
2. Build item 1 with closers only. Ship once three past days reconcile by hand.
3. Build item 2. Ship once August reconciles against Whop.
4. Watch for the first booking carrying a setter name; then build item 3 and
   add setters to the Slack post.
5. A week after the asks: check the no-show mark count, and re-send the ask
   if it is still zero.

Each code item ends with the five-axis review before the commit, and the number
it introduces is read against Whop or Calendly before it is reported as
correct.
