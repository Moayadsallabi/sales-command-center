# Connecting Calendly

Optional. Without it the dashboard works exactly as it did before — it just
cannot see anything that did not produce a recording.

## What it changes

The tracker is built on Fathom recordings landing in Notion, so every number on
the page starts from a call that happened. A prospect who cancels the night
before, or books and never turns up, leaves no recording and therefore leaves no
trace. The show rate that results divides recordings by recordings.

Connecting Calendly adds the other side:

| | Without Calendly | With Calendly |
| --- | --- | --- |
| Show rate | Recordings that weren't logged as a no-show, over all recordings | Calls that happened, over calls that were due |
| Cancellations | Invisible | Counted, with how much notice and who pulled out |
| Booking lead time | Unknown | Show rate by how far ahead the call was booked |
| Lead source | The scorer's reading of what the prospect said, on calls that happened | The utm tag on the link they booked through, on every booking |
| Pre-call context | Whatever came up on the call | Their booking-form answers, before anyone spoke |
| Closer | Whoever spoke most on the recording | Compared against who Calendly assigned it to |

## Setup

### 1. Get a token

Calendly → **Integrations & apps → API & webhooks → Personal access tokens →
Generate new token**. Copy it into `.env.local`:

```
CALENDLY_API_KEY=your_token_here
```

**Use an admin or owner's token on a team.** A member's token can only read that
member's own calendar, so every other closer's bookings go missing — and the
dashboard will say so rather than quietly reporting a smaller funnel.

### 2. Say which event types are sales calls

This is the step that matters. Left unset, *every* booking counts — one-to-ones,
internal syncs, coffee chats — and the show rate becomes meaningless.

```
CALENDLY_EVENT_TYPES=Strategy Call,Discovery Call
```

Names as they read in Calendly. Matching is case-insensitive and partial, so
`strategy` catches "Strategy Call" and "Strategy Call (60 min)" both. There is no
need for a dedicated event type — naming the ones you already have is enough.

### 3. Tag your booking links

Booking links carry their source if you put it there:

```
calendly.com/you/strategy-call?utm_source=instagram&utm_campaign=spring
```

Publish a different `utm_source` per place you post the link. That is what turns
"where did this booking come from" from a guess into a fact, and it works for
no-shows too, which the call table can never see.

### 4. Check it

```bash
npm run check:calendly
```

It verifies the token, reports whether it reaches the whole organisation or one
user, lists every event type booked in the window with whether it is being
counted, and samples recent bookings for the three fields the dashboard needs —
email, utm tag, form answers.

It **fails** if `CALENDLY_EVENT_TYPES` matches nothing, because that case is
otherwise indistinguishable from a quiet month.

## The calendar

Connecting Calendly adds a **Calendar** section to the page: one cell per day,
one chip per booking, held or not. It is there for the things a count cannot
show — which days fill and which stay empty, whether cancellations land on the
same weekday every week, and what is still on the book for the rest of the
month. Without a token the section is not on the page at all.

Three things it will not do:

- **It never calls an unmatched booking a no-show.** A booking with no recording
  behind it is drawn as *Not recorded*. Only Calendly's own no-show mark, or a
  call logged as one on the tracker, gets the no-show colour. Same rule as
  everywhere else here, and the same reason: "nobody turned up" and "nobody
  recorded it" want opposite fixes.
- **It never draws an unread month as an empty one.** Calendly is read over a
  window — `CALENDLY_LOOKBACK_DAYS`, ninety days by default, and a year ahead.
  Step back beyond it and the panel says the calendar was never asked about
  those weeks, rather than showing blank cells that read as a quiet quarter.
- **It does not follow the date buttons at the top of the page**, and says so on
  the panel. You move around a calendar by the month, so its own arrows do that.
  The closer filter does apply; the outcome and lead-source pills do not,
  because both describe a recording and most of what is drawn here never
  produced one.

### Why the times are not UTC

Every other date on this dashboard is read and printed as UTC on purpose: a call
date is a calendar day with no time in it, so handing it to the reader's own
zone slides it either side of midnight depending on who is looking.

A calendar is the one surface that cannot work that way. Calendly hands over
every start time as an instant — `2026-08-26T00:30:00Z` — and an instant only
becomes a day once you say whose day you mean. On a live account that exact time
is a call at half eight the previous evening for the team taking it; drawn as
UTC it lands in the small hours of the following morning, one cell to the right
of where everyone involved remembers it.

So the grid groups and prints in **the client's business day**, and names it on
the panel. That is one answer for the whole client — the same zone the ad spend
and the call dates are counted on — and it comes from `clients.time_zone` in the
registry, or `CLIENT_TIME_ZONE` on a deployment with no registry. The KPI
dashboard reads the same column. Nothing on this panel is used as a denominator
anywhere else, so no rate on the page changes.

**Unset, the grid is drawn in UTC and says so.** It does not guess, and the
plausible guesses are the trap rather than the safe option:

- **Not the Calendly account's own zone.** That is whoever created the login.
  This panel shipped that way on 7 September 2026 and was corrected the next
  day: the login is `America/Chicago`, the business is `America/New_York`. Every
  time on the grid was an hour early and nothing looked broken, because the
  times were still working hours. Measured across the 567 bookings in the read
  window, no chip was actually on the wrong *day* — the last call of Brey's
  evening is around 21:00 Eastern, and it would take one after 23:00 to cross.
  That is luck rather than design, which is the argument for the field being the
  business's own answer rather than the nearest zone to hand.
- **Not the reader's browser.** Two people would then see two calendars.

Set it to an IANA name (`America/New_York`), never the literal `EST`. A fixed
offset does not follow daylight saving and would be an hour out for half the
year.

## How a booking is matched to a call

On the prospect's email, then on how close the two sit in time — a booking and a
recording within a day of each other, nearest pair first.

The email comes from Notion's `Prospect Email` column, which the workflow fills
from the calendar invite. **In practice a lot of calls arrive without one** —
the invite does not always carry the invitee as an addressable attendee, and
calls recorded before the column existed have none at all.

So there is a fallback. A call with **no** email may be tied to a booking on the
name and the day instead, under conditions strict enough to be worth trusting:

- two name parts must agree, not one — first names collide, first-and-last on
  the same day does not
- the same calendar day, tighter than the day-either-side the email path allows
- exactly one candidate on each side; anything ambiguous is left unmatched

Those matches are counted separately and named on the panel, because a name on a
day is an inference and an address is an identifier. **A call that has an email
and still doesn't match is never name-matched** — that combination is telling
you something (wrong address captured, or the prospect booked another way) and
papering over it with a name would bury the signal.

Filling in `Prospect Email` on a call upgrades it from the inference to the
certainty — and `npm run backfill:emails` does that for you, copying the
address off the booking Calendly already holds. See below.

Matching nearest-first is what makes a repeat prospect come out right: someone
who books, no-shows, rebooks and then buys has two bookings and one recording,
and the recording attaches to the booking it actually belongs to.

## Filling the address back onto the call

```bash
npm run backfill:emails            # what it would write
npm run backfill:emails -- --apply # write it
```

Everything above describes how a call with no address is tied to a booking
anyway. This writes that address onto the row, so the next join does not have to
infer it again — and so the joins that cannot infer at all, chiefly the payment
reconciliation, start working on those rows.

Because those rows are exactly the ones the matcher had least to go on, nothing
is written on the name alone. Fathom holds the scheduled start time of the
calendar event it was recording; Calendly holds the scheduled start of the event
it created. The same moment means the same appointment, whatever the names
looked like, and that is what licenses the write.

| Outcome | What it means |
| --- | --- |
| Confirmed | The booking and the recording hold the same calendar slot. Written |
| Recovered | The matcher would not choose between two bookings; the recording's slot did, and the name agrees. Written |
| Unconfirmed | Matched on the name, with nothing able to check it. Two causes: no Fathom key, or the call was **moved by hand** after booking, so the recording sits on a slot no booking holds and the clock cannot vouch for anything. Not written without `--unverified` |
| Held back | The two records disagree — a different slot, a different person on the invite, or a different closer. Never written |
| No booking | Nothing on this calendar matches — either never booked here, or booked here under a name the call row cannot be recognised by |

Held-back rows are the point of the exercise as much as the written ones. On a
first live run they caught a booking 22 hours from the recording it was matched
to, a slot holding a booking under an entirely different name, and a slot whose
only booking had been cancelled — each of which would have attached one person's
payments to another person's call.

A slot on its own is never enough, which is why the name has to agree too: two
closers take bookings at the same hour, so the booking sitting in a slot is not
necessarily this call's.

### When the call was moved after it was booked

A call dragged to a different time in the calendar breaks the timestamp check
outright — the recording's slot then matches no booking at all. Those fall back
to a wider search on the name alone, three calendar days either side, and are
written only on `--unverified`:

```bash
npm run backfill:emails -- --apply --unverified
```

It still refuses to guess between people. Every booking the name ties to across
that window has to belong to **one person**, because the question is whose
address this is, and two candidates with two addresses cannot answer it however
close they sit. A prospect who booked, dropped out and rebooked twice is one
person and fills fine; two people sharing a first name do not.

Read these before writing them. They are the only rows here resting on a name,
which is the thing the rest of this script exists to avoid trusting.

The second opinion needs a Fathom key — `FATHOM_API_KEY`, or one
`FATHOM_KEY_<name>` per closer in `.env.local`, since a key only reaches its own
owner's recordings. Without one the run says so and writes nothing unless
`--unverified` is passed.

Rerunning is safe: a row that already has an email is never touched, whoever
typed it, so a second run writes only what arrived since the first. Notion's
page history is the undo.

## The five states a booking ends in

| State | What it means |
| --- | --- |
| Held | Matched a recording where the prospect turned up |
| No-show | Logged as a no-show on the recording, or marked as one in Calendly |
| Cancelled | Called off beforehand, by either side |
| Not recorded | Was due, wasn't cancelled, and no recording was found |
| Upcoming | Still ahead of us — counted as neither a show nor a no-show |

**"Not recorded" is deliberately not called a no-show.** It is either a prospect
who never turned up or a call that happened with nobody recording it, and those
want opposite fixes. The show rate is quoted as a range while any of them are
outstanding, and the range closes as recording coverage improves.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `CALENDLY_API_KEY` | — | The token. Unset disables all of the above |
| `CALENDLY_EVENT_TYPES` | every type | Which event types count as sales calls |
| `CALENDLY_LOOKBACK_DAYS` | 90 | How far back bookings are read |
| `CALENDLY_CACHE_SECONDS` | 300 | How long the event list is reused before asking Calendly again |
| `DEMO_WITHOUT_CALENDLY` | unset | Demo mode only. `1` previews the dashboard as it looks before Calendly is connected |

## Why the funnel takes a minute after a restart

Listing bookings is cheap. Reading each one's invitee — the email, the utm tag,
the form answers, the no-show mark — is a separate request per booking, and
Calendly answers 500 requests a minute per token. An account with 500 bookings
in the window therefore needs about a minute of allowance to read in full.

So the first load after a deploy or restart does not wait for it:

- The page renders immediately off the recordings, as it did before Calendly.
- The funnel says how far through the read it is.
- The read continues in the background, and the page's own 60-second refresh
  picks it up when it completes.
- **Nothing partial is ever quoted as a rate.** A show rate off half the
  calendar is not a rough number, it is the wrong one, so the panel shows
  progress rather than figures until the set is complete.

After that first fill, only new bookings cost anything. Calls that have already
happened are held for 12 hours; anything still upcoming is re-read on the cache
interval, because that is exactly what can still be moved or cancelled.

This all lives in the running process, so a redeploy starts the cycle again.

## Limits

- **The lookback window is not the date filter.** Set the dashboard to "All
  time" and it will show calls from before the bookings were read, with no
  bookings behind them. The panel names the window it covers.
- **Calendly's own no-show marking is barely used in practice.** On a live
  account of 500 bookings exactly one carried it. So a no-show is nearly always
  identified by the recording — a call logged with the No show outcome — or it
  lands in "not recorded". Marking no-shows in Calendly is the cheapest way to
  close that gap if you want it closed.
- **A member token sees one calendar.** The dashboard says which it got.
- **Outcome and source filters hide the funnel.** Filtering calls to "Customer"
  and then showing a booked-versus-held rate would measure two different things,
  so the funnel steps aside instead.
