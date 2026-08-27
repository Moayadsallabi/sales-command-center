# Spec — event type as a funnel signal

**Status:** specified, not built. **Applies to:** this repo and `perceptionismlabkpis`.
**Source:** Brey's team, Calendly walkthrough video, 2026-08-18.

## The gap

Both dashboards already read `event_type` onto every booking, and both use it for
exactly one thing: deciding whether the booking is a sales call. Source is then
taken from `utm_source` alone — `src/lib/calendly.ts:409` here,
`src/services/calendly-bookings.js:233` in the KPI dashboard.

That works for a lead who clicks a link. It cannot work for Brey's paid funnel,
because **setters book those calls by hand.** The lead sends a name and an email
and a setter enters them into Calendly; no link is ever sent, so no `utm` is ever
attached. Every paid-ads booking therefore arrives with a blank source.

Blank does not mean unknown. On this account it means *setter*, and the event
type is what says so.

## The mapping

| Event type | Funnel | Booked by | Brand | Closer |
| --- | --- | --- | --- | --- |
| Profitability Game Plan Call Team | paid_ads | setter, manually | — | round robin |
| Profitability Game Plan Call Chris | paid_ads | setter, manually | — | Christian |
| Profitability Game Plan Call Tpan | paid_ads | setter, manually | — | Tpan |
| Profitability Game Plan Session | paid_ads | setter, manually | — | round robin |
| Profitability Game Plan Call | organic | the lead, from the VSL page | Brey | round robin |
| Profitability Game Plan Call. | organic | the lead, from the VSL page | JP | round robin |
| Funded Blueprint Onboarding Call | post_sale | — | — | delivery team |

The Chris and Tpan calendars are **overrides, not pods**. A setter reaches for one
when round robin has misallocated — one closer holding more slots than the other,
or a specific slot that needs booking over. They are the same funnel as the Team
calendar, routed by hand.

**The trailing dot is a split, not a duplicate.** Brey and JP are the two brand
owners, each with their own VSL page, each page pointing at its own calendar.
Both calendars host the same two closers, so the host tells you nothing here —
the event type is the only thing that separates one brand's organic traffic from
the other's. Until 2026-08-19 both repos recorded the dotted name as a duplicate,
which would have justified merging the two brands into one number.

## Where it lives

`sales-rules.json`, as a new `calendly_funnel_map` block. Bump `version` 1.1.0 →
1.2.0 and copy the file whole to both repos, per its own README. That file exists
because the two dashboards drifted apart on the same question four times in one
evening; this is the same class of question and belongs under the same guard.

Proposed shape, one entry per event type:

```json
"calendly_funnel_map": {
  "match": "exact",
  "unmapped": "unknown",
  "types": {
    "profitability game plan call team": {
      "funnel": "paid_ads", "route": "setter_manual",
      "brand": null, "closer_hint": null
    },
    "profitability game plan call.": {
      "funnel": "organic", "route": "self_serve",
      "brand": "jp", "closer_hint": null
    }
  }
}
```

## Rules the build must obey

**1 · Match exactly. Never on a substring.** Both matchers are case-insensitive
substring today — `src/lib/calendly.ts:479`, `calendly-bookings.js:254`. That is
correct for the counting rule, where a loose match is the defence against a new
event type going uncounted. It is wrong here: `"Profitability Game Plan Call"` is
a prefix of five other names, so a substring map would label the whole paid funnel
as Brey's organic traffic. Match the full name, trimmed, case-insensitive.

**2 · An unmapped type is `unknown`, never a default.** No falling back to
organic, no falling back to the most common funnel. `unknown` is a number we can
see and chase; a default is a wrong number that looks right.

**3 · A missing utm on a paid_ads booking is expected, not a gap.** Anything that
reports attribution coverage must read the funnel first, or it will report the
healthy half of the business as broken. The inverse is a genuine fault: an
`organic` booking with no utm means that VSL page's link is untagged, and that
should be surfaced.

**4 · Where utm and event type both speak, neither overrides the other.** The
event type fixes the funnel; the utm adds granularity within it (which page,
which post). If they contradict — an organic event type carrying
`utm_source=meta` — flag it rather than resolve it. That is a real change in how
the funnel runs, and picking a winner in code would hide it.

**5 · `closer_hint` is a hint.** Who actually took the call is settled by the
recording, as it is now. The Chris and Tpan calendars say who the call was
*routed* to. Calendly host names are already known not to be people here — see
`clients/brey/call-tracking.md`, where "Advisor Coach" is Tpan's calendar and
"Success Team" is shared.

**6 · No headline number changes.** This adds a dimension to bookings that are
already counted. If a total moves, something else broke.

## Verification

- Extend `npm run check:calendly` to report event types that are *ruled on but
  unmapped*, separately from ones nobody has ruled on at all. Same principle as
  the existing ledger: stay quiet until Brey's team invents something.
- Then check the split against the system that owns it, per the standing rule
  that a green suite is not evidence a number is right. **Discord owns "was this
  booked by a setter"** — the setter-booked-calls feed is the independent count
  the paid_ads total has to agree with. Reconcile once before this is shown to
  anyone.

## Still unanswered

Ask Brey's team; do not infer.

1. **`Profitability Game Plan Call Team.`** — the dotted Team calendar. It did not
   appear in the walkthrough and was never explained. Assumed to follow the Team
   calendar, confirmed by nobody.
2. **`Profitability Game Plan Session`** — stated to be setter-booked, but its
   distinct purpose against the Team calendar was not given.
3. **The four Funded Blueprint sales types** — `THE FUNDED BLUEPRINT`,
   `THE FUNDED BLUEPRINT (STRATEGY SESSION)`, ` The Funded Blueprint — Strategy
   Call`, `The Funded Blueprint Enrollment Call`. A separate funnel with its own
   pod, and the walkthrough covered only its onboarding call. They are counted as
   sales calls and would map to `unknown` on day one.
