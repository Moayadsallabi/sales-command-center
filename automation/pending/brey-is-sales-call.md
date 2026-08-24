# Brey — two changes waiting for a human

**Why this is a file and not already live:** the edit to the running workflow was
refused by a permission guard on 2026-08-24. Everything about it is finished and
tested; it just needs a human to paste it.

`npm run configure:client` already writes this rule for any client configured
from now on. Brey's workflow was generated before it existed, so his copy is the
one that needs the paste — same reason a rule added to the generator has never
reached a client who was already set up.

## What it changes

A recording is scored only if its meeting **title** names it. A call started
outside the booking link is titled "Impromptu Google Meet Meeting" and is
refused, which across August dropped **29 recordings** into the Slack rescue
queue. That queue was given **3 rulings**. Both of Christian's calls on 23 August
were in the unread remainder, which is why a whole closer was missing from the
dashboard while the alert worked perfectly.

Underneath the title rule, a call whose title names nothing is now accepted when
**it ran fifteen minutes or more AND somebody other than the closer speaks on
it.** The block list is still checked first and still wins.

## What it does to the last month, simulated against all 74 August recordings

- **16 more would be scored**, including both of Christian's (72 min and 63 min).
- **0 currently scored would stop.**
- The two 65-minute "Team Meeting" recordings **stay out**, because the block
  list runs before the evidence.

Edge cases checked by hand, all correct: solo recording → out. Five-minute
ad-hoc → out. Long team meeting with an outsider → out. Empty body → out, and
**without throwing** — an expression that throws inside n8n takes a branch
silently, so every read is guarded.

## How to apply it

1. Open the workflow `IuXTEhLD7phHAx5O` → node **Is Sales Call?**
2. Replace the whole condition value with the expression below.
3. **Save AND publish.** An edit that is not published is a draft, and the live
   version goes on running the old rule.
4. Confirm with `npm run check:dropped -- --client brey --since 2026-08-25` a
   day later: new ad-hoc calls should stop appearing in the backlog.

---

# 2. The offer check — built, and it needs the workflow regenerating

The gate above is deliberately blind to whose **product** was sold. That is
fine while a human waves each ad-hoc call through, and not fine once they walk
in on their own — so this was built the same day.

**What it does.** The scorer already receives the client's offer description;
that is what it judges the pitch against. It now also answers, in the same
response, whether the thing being *sold* on the call was that offer, and quotes
the line that decides it. Both land on the tracker as `Offer Match` and
`Offer Evidence`, **which already exist on Brey's database** — added and
verified on 2026-08-24, all 51 columns present.

**A row marked `different offer` reaches no figure on either dashboard.** No
list, no memory, nobody remembering to add anything. Ludgero's Amazon call would
have been caught by this on the day, from the sentence where Tpan introduces
himself as part of Kevin's team.

**`unclear` is counted normally, and so is any row scored before the columns
existed.** Only the positive verdict removes anything. Deleting a real sale is
the expensive mistake — one was deleted that way on 22 August and took two days
to put back — so the burden of proof sits entirely on that one verdict.

## How to apply both changes at once

The filter above and the offer check are both in the generator now, so one
regeneration carries both:

```bash
cd sales-command-center && npm run configure:client -- --client brey --name "Brey" --database <brey's database id> --phrase "Profitability Game Plan" --phrase "The Funded Blueprint" --exclude "Onboarding" --exclude "Team Meeting" --exclude "Standup" --exclude "Internal" --channel "<the alert channel>" --offer rubric/clients/brey.local.md
```

Then import the written file into n8n and re-attach the two credentials.

**The webhook address does not change** — it is `fathom-webhook-brey`, derived
from the client name, so Fathom keeps talking to it after the import. That is
the one thing worth checking after: post a test call and confirm an execution
appears.

If you would rather not re-import, the three nodes that changed are
**Is Sales Call?** (the expression below), **Load Rubric** (the system prompt
and the output schema), and **Write to Notion** (two more properties). The
expression is the only one small enough to paste by hand.

## The expression

```
={{ (() => { const b = $json.body || {}; const title = String(b.meeting_title || "").toLowerCase(); const blocked = ["onboarding","team meeting","standup","internal"]; if (blocked.some((x) => title.includes(x))) return false; if (b.force_score === true) return true; const sales = ["profitability game plan","funded blueprint enrollment","funded blueprint — strategy","funded blueprint (strategy","the funded blueprint"]; if (sales.some((s) => title.includes(s))) return true; /* A title that names nothing is the normal state for a call started outside the booking link - Google calls it "Impromptu Google Meet Meeting". Judge the recording instead: long enough to be a call, and somebody other than the closer speaking on it. */ const mins = (Date.parse(b.recording_end_time) - Date.parse(b.recording_start_time)) / 60000; if (!(mins >= 15)) return false; const host = ((b.recorded_by || {}).name) || ""; const voices = new Set((b.transcript || []).map((t) => (((t || {}).speaker) || {}).display_name).filter(Boolean)); voices.delete(host); return voices.size >= 1; })() }}
```
