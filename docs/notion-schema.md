# Notion database columns

The tracker database needs every column below. Names are matched exactly — renaming
one silently breaks that field, so copy the names as written.

Run `npm run check:notion` after setting them up. It reports any column that is
missing or the wrong type before you ever run a real call through the workflow.

## Call details

| Column | Type | Set by |
| --- | --- | --- |
| `Name` | Title | The prospect's name, taken from the meeting title |
| `Prospect Email` | Email | The external person on the calendar invite — see below |
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
| `Payment Structure` | Select | PIF, installments, custom |
| `Lead Source` | Select | Skool, IG, YouTube, Referral, Direct, Unknown |
| `Price Discussed` | Number | |
| `Price Closed` | Number | |
| `Collected On Call` | Number | Taken during the call itself |
| `Cash Collected` | Number | Every payment received so far — filled in by hand |
| `Outstanding` | Number | Still owed — filled in by hand |
| `Currency` | Select | USD, EUR, GBP |
| `FX Rate` | Number | Rate from this row's currency to the reporting currency |
| `Prospect Revenue` | Text | |
| `Niche` | Text | |
| `Location` | Text | |

Leave the number columns on Notion's plain **Number** format rather than Dollar.
The row's own `Currency` says what the amounts are, and a dollar sign stamped on
every column would misprice every non-USD deal on sight.

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

## Lead quality

Eight factors scoring the **prospect**, not the closer. `Lead Score` holds their
total out of 100. The maximums differ per factor because the factors do not matter
equally, and each one maps to one of the seven buying beliefs — so a lead that
arrived weak on Money can be read against how the closer handled the Money belief.

| Column | Type | Out of | Belief |
| --- | --- | --- | --- |
| `Lead Score` | Number | 100 | — |
| `Pain Severity` | Number | 15 | Pain |
| `Urgency` | Number | 15 | Cost |
| `Desire Clarity` | Number | 15 | Desire |
| `Solution Belief` | Number | 15 | Trust |
| `Self-Efficacy` | Number | 10 | Doubt |
| `Authority` | Number | 10 | Support |
| `Financial Capacity` | Number | 10 | Money |
| `ICP Fit` | Number | 10 | — |
| `Lead Read` | Text | | What the factors add up to, and the move that fits |

## Objections

| Column | Type | Options |
| --- | --- | --- |
| `Objections` | Multi-select | Price, Timing, Partner, Think about it, Doubts the method, Doubts themselves, Tried before, Comparing options, No time, None raised |
| `Primary Objection` | Select | Same options |

`Objections` holds every objection the prospect voiced; `Primary Objection` holds the
one that decided the call, and is empty when the call closed or nothing was raised.

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

**Set the Select options up in advance.** Notion's page-creation API will add a
missing option to a Select column as it writes, but not every API surface does —
writing to a data source directly is rejected outright with "the data source must
be updated to add it", and an option list you have typed out yourself also lets you
colour-code the values and stops a typo quietly becoming a ninth option. `npm run
fix:notion` fills in every option list for you.

**`Closer` ships with no options, so type your closers' names in before the first
call.** It is the one Select whose values cannot be known in advance, which also makes
it the one most likely to be rejected on a first write if the list is empty. The
workflow fills it with the internal person on the calendar invite, matching the name
exactly as the invite spells it. When several
internal people are on one invite, the workflow credits whichever of them actually
spoke the most in the transcript — a manager silently shadowing does not steal the
call. Cleanest is still one internal invitee: the closer. If a name comes through
wrong, fix the calendar invite rather than the Notion row.

**`Prospect Email` is what ties a call to everything else you know about that
person.** Fathom's webhook lists everyone on the calendar invite with their email
address and a flag saying whether they are internal; the workflow takes the first
external one and lower-cases it, so it matches however the address was typed.

On its own this column does nothing for the scorecard. It matters because it is
the key everything else is matched on. The KPI dashboard uses email for which DM
produced the lead, which ad produced the DM, and which payments arrived — so with
the email on the call row, a score can be read against the ad that generated the
call. This dashboard uses it too, whenever Calendly is connected: it is how a
recording is tied back to the booking that produced it, which is what makes a
real show rate possible (see [`calendly.md`](calendly.md)). Without it, the
systems can only be matched on name and date, which holds until two prospects
share a first name.

An invite with no external attendee — a call started ad hoc, or a rescheduled
link where the guest never accepted — leaves this empty. That is honest: the row
still scores, it simply cannot be tied to a lead automatically.

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

**`Collected On Call` is only what was taken during the call.** A deal agreed on the
call but paid the next morning collected nothing on the call, so it is `0` — that
column measures the closer, and cash in hand before the prospect hangs up is a
different skill from cash that arrives once they have slept on it. It is the only one
of the three payment columns the workflow writes.

**`Cash Collected` is everything received to date, and `Outstanding` is what is
still owed.** Both are filled in by hand as payments arrive; the workflow never
touches them, because at scoring time no one knows what will land later. While
`Cash Collected` is blank the dashboard treats the on-call figure as everything
received so far, so a paid-in-full call needs no maintenance. The KPI row shows
**On the Call**, **Cash Collected** and **Outstanding** separately, which is what
stops a part-paid deal reading as a full one.

**Every amount is in the row's own `Currency`.** A €3,000 retainer is stored as
`3000` with `Currency` set to `EUR` — never pre-converted, so the row always matches
the contract. `Currency` is the currency of the **deal**, not of the payment. When a
client pays in something else — a €3,000 invoice settled with a $1,200 transfer —
convert that payment at the rate it actually landed at and record the euro figure in
`Cash Collected`, because a row that mixes a euro price with a dollar payment makes
`Outstanding` meaningless. The bank or Stripe payout tells you what it credited as;
whatever is left of the €3,000 after it is what is still owed. To total across currencies the dashboard multiplies by that row's
`FX Rate`, the rate to the reporting currency fixed at signing (`NEXT_PUBLIC_REPORTING_CURRENCY`,
default USD). Rows already in the reporting currency need no rate. If a foreign-currency
row has no `FX Rate`, the dashboard counts it at 1:1 and says so in a banner rather than
absorbing the error silently.

**A REFUND outcome** removes that call's revenue and cash from every dashboard total,
so in a month with a refund the dashboard will read lower than the bank statement —
that is deliberate: the dashboard shows what the calls are worth, not the ledger.

**The written breakdown lives on the page, not in a column.** Open any row in Notion
and the page body holds the dimension-by-dimension reasoning, the best moment, the
biggest miss and the flags. Columns hold only what needs to be sorted, filtered or
charted.

**Old rows stay readable.** Calls recorded before the scorecard existed have no
dimension scores. The dashboard leaves them out of score averages rather than counting
them as zero, so your averages do not get dragged down by history.

**`Lead Score` answers the question the closer scores cannot.** The eight dimensions
say how well the call was run. The eight lead factors say what the closer was handed.
Without both, a 5/10 call is unattributable — it could be a closer who fumbled a good
prospect or a closer who did fine with someone who was never going to buy, and those
want opposite fixes. Two closers can only be compared fairly once you can see whether
they were fed the same quality of lead.

**A factor the call never touched is left empty, not scored.** If money never came up,
`Financial Capacity` stays blank. `Lead Score` is then the total of the factors that
were scored, scaled to 100 — so a call that ended before the money question is not
punished for it. Below four scored factors there is no `Lead Score` at all, because a
lead assessed on three answers is not a lead anyone has assessed.

**Quotes carry the time they happened at.** Every quote in the written breakdown ends
with a `[mm:ss]` taken from the transcript, and the dashboard turns those into links
straight into the recording at that moment. This is what makes a score arguable: a
closer who disputes a 4 on Tension can click the timestamp and hear it. Rows scored
before this existed simply have no timestamps and still render fine.
