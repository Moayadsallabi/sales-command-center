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
from the calendar invite. **Calls recorded before that column existed have no
email, so they cannot be matched** and show up as recorded calls with no booking
behind them. That is stated on the panel rather than hidden.

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
| `CALENDLY_LOOKBACK_DAYS` | 180 | How far back bookings are read |
| `CALENDLY_CACHE_SECONDS` | 300 | How long a read is reused before asking Calendly again |
| `DEMO_WITHOUT_CALENDLY` | unset | Demo mode only. `1` previews the dashboard as it looks before Calendly is connected |

Each booking costs a second request to Calendly for its invitee, which is where
the email, the utm tags and the form answers live. The cache is what keeps the
dashboard's 60-second auto-refresh off Calendly's rate limit; lower it if you
want bookings to appear faster, at the cost of more requests.

## Limits

- **The lookback window is not the date filter.** Set the dashboard to "All
  time" and it will show calls from before the bookings were read, with no
  bookings behind them. The panel names the window it covers.
- **A member token sees one calendar.** The dashboard says which it got.
- **Outcome and source filters hide the funnel.** Filtering calls to "Customer"
  and then showing a booked-versus-held rate would measure two different things,
  so the funnel steps aside instead.
