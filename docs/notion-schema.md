# Notion database columns

The tracker database needs every column below. Names are matched exactly — renaming
one silently breaks that field, so copy the names as written.

Run `npm run check:notion` after setting them up. It reports any column that is
missing or the wrong type before you ever run a real call through the workflow.

## Call details

| Column | Type | Set by |
| --- | --- | --- |
| `Name` | Title | The prospect's name, taken from the meeting title |
| `Closer` | Select | The internal person on the invite — who took the call |
| `Call Date` | Date | The recording date |
| `Duration (min)` | Number | Recording length |
| `Recording URL` | URL | Fathom share link |
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

**`Closer` is deliberately left empty.** The workflow fills it with whoever was on the
calendar invite from your side, so the options build up as your team takes calls. If a
name comes through wrong, fix the calendar invite rather than the Notion row.

**The written breakdown lives on the page, not in a column.** Open any row in Notion
and the page body holds the dimension-by-dimension reasoning, the best moment, the
biggest miss and the flags. Columns hold only what needs to be sorted, filtered or
charted.

**Old rows stay readable.** Calls recorded before the scorecard existed have no
dimension scores. The dashboard leaves them out of score averages rather than counting
them as zero, so your averages do not get dragged down by history.
