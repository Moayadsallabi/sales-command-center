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
certainty.

Matching nearest-first is what makes a repeat prospect come out right: someone
who books, no-shows, rebooks and then buys has two bookings and one recording,
and the recording attaches to the booking it actually belongs to.

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
