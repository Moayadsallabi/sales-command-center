# Measuring how right the dashboard is

```bash
npm run check:accuracy
```

Marks the dashboard's homework against an answer key: a record of what actually
happened on a set of calls, written by someone who was there.

Without it, a change to how bookings are matched to calls produces an opinion.
"This should catch more calls" is a guess that nobody — including whoever wrote
it — can check. With it, a change either moves the number or it doesn't.

## The answer key

Copy [`fixtures/accuracy-truth.example.json`](../fixtures/accuracy-truth.example.json)
to `fixtures/accuracy-truth.json` and fill it in from a closer's own tracking
sheet, which is usually the most complete record that exists.

```json
{
  "label": "Tpan A — 1 to 16 August 2026",
  "source": "the closer's own Google Sheet, filled in as the calls happened",
  "calls": [
    { "date": "2026-08-01", "name": "Alex Morgan", "showed": true, "recorded": true }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `date` | The day the call was due, as the closer recorded it |
| `name` | The prospect, however the closer wrote it — first name only is fine |
| `showed` | Whether they actually turned up. The thing being graded |
| `recorded` | Whether a recording exists. Drives the missing-from-tracker warning |
| `disqualified` | Optional. Kept for reference; not currently graded |

**The real file never leaves the machine.** It holds prospect names, and this
repo ships to other clients — `.gitignore` excludes it and lets only the example
through. Pass a different path as an argument to grade another closer or period.

## Reading the result

```
  on the calendar     29 of 48   60%  — a booking was found
  in the tracker      32 of 48   67%  — a scored call was found
  answered            21 of 48   44%  — we committed to showed / did not
  ├─ correct          18        86% of what we answered
  └─ wrong             3
  unsure               8        — booking found, no recording either way
  no booking          19        — not on this Calendly at all
```

Three separate things, and they fail for different reasons:

- **Answered vs correct** is the matching logic. Improving the matcher moves this.
- **No booking** is the ceiling. Those calls were booked outside Calendly, so no
  amount of code will reach them — it moves when booking habits move.
- **Unsure** is recording coverage. A booking was found, but nothing says whether
  anyone turned up. It shrinks when every booked call gets recorded.

Chasing the wrong one of those three is the most likely way to waste a week.

## The warning that matters most

```
  ⚠ Recorded by the closer but missing from the tracker
    2026-08-02  Emmanuel
    2026-08-03  Robert
```

A call the closer recorded that never produced a row in Notion is invisible to
**every** figure on the dashboard — close rate, cash collected, the scorecards —
not just the booking funnel. It means the automation that pulls calls out of
Fathom dropped them.

This is the one line worth watching after every run. It found four such calls in
a fortnight the first time it was run, which is roughly one in seven of that
closer's recorded calls silently missing from every number on the page.

## What it runs against

The app's own modules, compiled and imported directly — not a reimplementation.
A copy of the matcher would happily pass its own test while the real one failed,
which is worse than having no test at all.

It therefore needs the same credentials the dashboard does. Run `npm run
check:notion` and `npm run check:calendly` first if it cannot connect.
