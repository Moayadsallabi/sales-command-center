# Rubric changelog

## 2.0.0 — 2026-09-05

Written after an audit of the 123 calls scored on Brey's tracker under 1.2.0
to 1.7.0: mean 4.79, 88 of 123 under 5.5, no call above 7.5, one 9 and no 10 in
927 dimension scores. Closed calls did score higher than lost ones on every
dimension, so the ordering was sound; the level was not.

- **Bands split.** 7–9 was one band ("held throughout", "clean sequence") and
  the model resolved anything good to 7. Every dimension now has separate 7, 8
  and 9 descriptions, and every 10 describes something the caller did rather
  than something the prospect did.
- **Timestamps reach the model.** The transcript now arrives as
  `[mm:ss] speaker: text`. Until now the join dropped Fathom's per-line time, so
  no quote ever carried the `[mm:ss]` the rubric asked for and a pause could not
  be seen at all. Tension is now read off the gap between the price line and the
  caller's next line.
- **The process is scored, not a script.** Tension, Objection Resolution and
  Qualification described a one-call close: say the price, go silent, pace,
  isolate, certainty before money. Brey's closers run deposit-and-balance
  closes, and the scorer flagged Follow-Up Trap on 37 of 45 deposit calls and
  Early Price Drop on 32 of 59 sales. A scheduled second step with a deposit or
  a dated commitment is now a resolution; a follow-up with neither is still a
  trap. The two flags say so explicitly.
- **Not a sales call.** `Offer Match` gains a fourth verdict for recordings
  that are not a conversation with a prospect. The lowest call on the board was
  a team review of another call, scored 2.4 as a lost sale.
- **An overall needs five scored dimensions.** Unassessed dimensions drop out
  of the average, so a two-dimension payment call sat as the joint top call at
  7.5. Below five the dimension scores stand and the overall is withheld.
- **Verdicts.** 9–10 Elite, 8–8.9 Strong, 7.5–7.9 Good, 5.5–7.4 Average, under
  5.5 Fundamentals need work. "Good" starts at 7.5 to match the dashboard's
  ruling of 2026-08-27; 7.0 was previously labelled "Strong call" while the
  prompt said 7 was merely good.
- **Weakest Belief** now asks which belief the caller built least, not which
  one the prospect arrived weakest on. It read "Money" on 58 of 123 calls.

Rows scored under earlier versions keep their `Rubric Version`. Rescore them
with `npm run rescore` rather than comparing across versions.
