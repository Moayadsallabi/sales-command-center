# Notion database columns

The tracker database needs every column below. Names are matched exactly — renaming
one silently breaks that field, so copy the names as written.

Run `npm run check:notion` after setting them up. It reports any column that is
missing or the wrong type before you ever run a real call through the workflow.

## Call details

| Column | Type | Set by |
| --- | --- | --- |
| `Name` | Title | The prospect's name, taken from the meeting title |
| `Closer` | Select | Who took the call — see the note on how it is picked |
| `Call Date` | Date | The recording date |
| `Duration (min)` | Number | Recording length |
| `Recording URL` | URL | Fathom share link |
| `Recording ID` | Number | Fathom's id for the recording — the duplicate check matches on this |
| `Summary` | Text | Two or three sentences on what happened |

## Commercial

| Column | Type | Options |
| --- | --- | --- |
| `Outcome` | Select | Customer, BAMFAM, No offer made, No deal, No show, REFUND |
| `Tier` | Select | Tier 1, Tier 2 |
| `Payment Structure` | Select | PIF, installments, custom |
| `Lead Source` | Select | Skool, IG, YouTube, Referral, Direct, Unknown |
| `Price Discussed` | Number | |
| `Price Closed` | Number | |
| `Cash Collected` | Number | |
| `Prospect Revenue` | Text | |
| `Niche` | Text | |
| `Location` | Text | |

## Scorecard

Eight dimension scores, 1–10. `Quality Score` holds their average, which is what the
dashboard charts over time.

| Column | Type |
| --- | --- |
| `Quality Score` | Number |
| `Frame Ownership` | Number |
| `Discovery Depth` | Number |
| `Belief Architecture` | Number |
| `Pitch Precision` | Number |
| `Tension Management` | Number |
| `Objection Resolution` | Number |
| `Qualification` | Number |
| `Strategic Awareness` | Number |
| `Rubric Version` | Text |

A dimension the call never gave evidence for is left empty rather than scored, and
`Quality Score` averages only the dimensions that were scored. `Rubric Version`
records which version of the rubric produced the scores, so when the rubric changes
you can tell a v1.2 six from a v1.1 six instead of mixing them in one trend line.

## Flags and coaching

| Column | Type | Options |
| --- | --- | --- |
| `Value Leak` | Checkbox | |
| `Follow-Up Trap` | Checkbox | |
| `Early Price Drop` | Checkbox | |
| `Weakest Belief` | Select | Pain, Doubt, Cost, Desire, Money, Support, Trust, None |
| `The Moment` | Text | |
| `Next Call Drill` | Text | |

## Notes

**Select options create themselves.** Notion adds a missing option to a Select column
the first time the workflow writes it, so you do not have to type the option lists in
advance. Setting them up anyway is worth doing for `Outcome` and `Tier`, because it
lets you colour-code them and stops a typo becoming a new option.

**`Closer` is deliberately left empty.** The workflow fills it with the internal person
on the calendar invite, so the options build up as your team takes calls. When several
internal people are on one invite, the workflow credits whichever of them actually
spoke the most in the transcript — a manager silently shadowing does not steal the
call. Cleanest is still one internal invitee: the closer. If a name comes through
wrong, fix the calendar invite rather than the Notion row.

**A no-show still gets a row.** When fewer than 50 words of transcript come through,
the workflow logs the call — name, closer, date, recording link — with the outcome
`No show` and no scorecard, so show rate stays honest without fake scores dragging
the averages. If the outcome guess is wrong (say the recording simply failed), correct
the row by hand.

**When a BAMFAM closes later, update the original row.** A two-call close otherwise
sits in the tracker as one loss and one win for the same deal, which understates the
close rate. When the follow-up call lands the deal, open the first call's row and
change its outcome from BAMFAM to Customer (leave the money on whichever call
collected it, so cash is never counted twice).

**Cash Collected is what was taken on the call.** A REFUND outcome removes that
call's revenue and cash from every dashboard total, so in a month with a refund the
dashboard will read lower than the bank statement — that is deliberate: the dashboard
shows what the calls are worth, not the ledger.

**The written breakdown lives on the page, not in a column.** Open any row in Notion
and the page body holds the dimension-by-dimension reasoning, the best moment, the
biggest miss and the flags. Columns hold only what needs to be sorted, filtered or
charted.

**Old rows stay readable.** Calls recorded before the scorecard existed have no
dimension scores. The dashboard leaves them out of score averages rather than counting
them as zero, so your averages do not get dragged down by history.
