# How to settle a disagreement about a number

Four systems describe the same sales calls, and they disagree constantly. Every
round of "is this figure right" has so far been argued from whichever source was
nearest to hand, which is why the same argument keeps happening.

This is the procedure that ends it. It is short on purpose.

## The rule in one line

**Every fact has exactly one owning system. A disagreement is not a vote — you
go and ask the owner.**

## Who owns what

| The fact | Who owns it | What that source CANNOT tell you |
| --- | --- | --- |
| A call was booked, moved, or called off — by whom, when, with how much notice | **Calendly** | whether anybody turned up |
| Money arrived — how much, when, refunded | **Whop** | what was agreed, or that a call happened |
| **What was agreed** — the price, the payment plan, the dates | **the recording** | whether it was ever honoured |
| Whether anybody turned up | **the recording** — that it exists, and how much was said on it | — |
| How the call went — outcome, objections, quality | **the recording**. The tracker is a person's reading of it | — |
| Which offer the call was for | **the recording** | — |
| Who took the call | **Calendly's assignment**, checked against who speaks on the recording | — |

## The two sources that own nothing

**The closers' own sheets own nothing.** They are a claim by the person being
measured. Useful, and never the deciding answer.

**The Notion tracker owns nothing about money.** Its money columns are typed by
hand, and its outcome is one person's reading of a call.

Both are alarms rather than answers. Their value is that when they disagree with
an owner, the gap names a broken pipe — see step 5.

## The procedure

**1. Write the question as a single fact.**
Not "is Brian's row right" — a row holds a dozen facts and only one is in
dispute. "What price did Brian agree to" is answerable; "is the row right" is
not.

**2. Look up the owner in the table above.**

**3. Read the owner directly.** Not an export, not a mirror, not a note from
last week. The live system.

**4. If the owner cannot answer, stop and say so.** Do not quietly drop to a
weaker source. This is the step that was missing, and it is where the arguments
came from: Whop cannot tell you what a part-paid deal was worth. It can only
tell you the floor.

**5. Treat the disagreement as a second finding.** The answer fixes one figure.
The gap tells you which pipe is broken, and that is usually worth more:

- Closer's sheet ahead of the tracker → calls are not reaching the tracker.
- Tracker ahead of Whop → money was recorded that never arrived, or a payment
  cannot be matched to its buyer.
- Whop ahead of both → sales are happening on calls nobody logged.

**6. Write down the answer and where it came from.** If a figure was changed
because money looked missing, it goes in `money-claims.json` — `npm run
check:claims` re-asks the processor for ever, because "the processor has not
seen this money" is a reading of one moment and it expires.

## Five traps, each one paid for

**Totals agreeing proves nothing about any row.** September's two closer sheets
came to $35,850 against Whop's $35,396 — $454 apart, which reads as healthy. It
was hiding $3,750 marked collected that never arrived, and about the same again
of real money in Whop from August calls and subscription renewals. The two gaps
cancelled. Reconcile rows, not totals, whenever the output is a list of people.

**Cash received is a floor on the deal, never the deal.** Brian had $1,000 in
Whop, his closer's sheet said $2,000, the dashboard said $4,000. The recording
settles it: *"It's 4K at the moment"*, agreed on the call, $1,000 down and
$3,000 still owed. Letting Whop decide the deal size would have written off
$3,000 nobody would then have chased — and would shrink every payment plan to
whatever had been paid so far.

**Two sources that both come from the same upstream are one source.** Two
figures agreeing is not corroboration when both are computed from the same
total. A refunded customer reached a chase list this way, listed as owing money
he had already been given back.

**A missing record is not a zero.** A refusal to attribute and a measured zero
must never render the same way. An ad with no traceable conversations read as an
ad that produced none.

**A name is not an identifier, and a near-match is not a match.** September's
$500 from "Shamer" sits in Whop under the billing name "Cristian delarosa". Two
Cristian Delarosas paid $500 each on the same day under different addresses.
Match on an identifier, and when only a name is available, say that is what you
did.

## Worked example

**Question:** what price did Brian agree on 3 September?

1. The fact: the agreed price. Not the cash, not the outcome.
2. Owner: the recording.
3. Read it — *"So typically it's 5K, but we're doing a pre-sale... It's 4K at the
   moment"*, Brian: *"4K, you said 4K?"*, $1,000 down, $1,000 by 18 September,
   $2,000 after.
4. Answer: **$4,000.** The dashboard was right; the closer's sheet was wrong.
5. Second finding: Tpan's sheet says $2,000, which is the amount that unlocks
   group coaching and came up repeatedly on the call. His sheet understates the
   deal, so $2,000 of what Brian owes would never have been chased.
6. Nothing to log in `money-claims.json` — no figure was changed on a
   missing-money reading.

Note where "always trust Whop" would have landed: $1,000.
