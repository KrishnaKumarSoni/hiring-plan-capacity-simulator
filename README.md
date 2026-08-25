# Hiring Plan Capacity Simulator

A result-first prototype for **candidate.fyi**: describe a hiring plan in 2–3 lines of plain
text, and find out whether it can actually be executed with your current interviewer capacity —
and if not, **what breaks, when it breaks, and what change fixes it**.

> **The core insight:** total interviewer hours can look sufficient while the plan is still
> impossible. Capacity is perishable week by week, different stages need different interviewer
> skills, and the same senior people often back multiple panels (System Design *and* Staff+).
> Naive per-pool capacity checks double-count those humans. A weekly max-flow allocation over
> interviewer→pool eligibility catches it: every pool passes independently, and the week is
> still infeasible.

## Architecture

**LLM = parser. Forecast = deterministic engine.**

One LLM call (Claude, structured output) turns messy hiring-plan text into a typed schema —
reqs, targets, deadlines, funnel rates that were explicitly stated. Every inferred or defaulted
value is visibly labeled (`provided` / `assumed` / `default`). Capacity allocation and forecast
outputs are fully deterministic, because hallucinated operational forecasts are worse than no
forecasts. If no `ANTHROPIC_API_KEY` is configured, a regex heuristic parser takes over (and
says so); no forecast number ever comes from the LLM either way.

The engine (`src/engine/`, plain TypeScript, no UI dependencies):

1. **Backwards funnel math** — candidates required at each stage from target hires ÷ downstream
   survival, including offer acceptance.
2. **Weekly demand** — per-req sourcing cadence, stage-to-stage lags, per-stage panel
   composition, prep/feedback overhead, and expected booking waste (`1/(1−w)` bookings per
   completed interview).
3. **Weekly supply** — per-interviewer residuals: `cap − existing load`, zeroed on PTO weeks.
   Never aggregated across the horizon; unused W1 hours cannot fix a W12 shortfall.
4. **Max-flow feasibility** — per week, Edmonds-Karp over
   `source → interviewer → eligible pool → sink`. The min cut yields the bottleneck pool set,
   its combined demand, the *unique* capacity of the humans behind it, and the named overlap
   people.
5. **Backlog simulation** — unserved interviews queue and roll forward; completion dates derive
   from the simulated pipeline, which is what turns a mid-plan capacity dip into a slipped
   deadline.
6. **Scenarios & sensitivity** — every intervention and perturbation is a full deterministic
   re-run.

Results are **capacity feasibility**, not calendar feasibility — max-flow proves eligible hours
can be allocated, not that specific calendar slots line up.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine unit tests (tiny datasets with hand-computable answers)
npx tsx scripts/debug.ts   # full numeric trace of the sample plan
```

Optional: set `ANTHROPIC_API_KEY` to enable the LLM parser (heuristic fallback works without it).

## The sample plan

12 backend engineers by Dec 15 across three reqs, a 20-person engineering roster where the
System Design and Staff+ panels share five senior people, week-varying existing load, and
normal Nov–Dec PTO. The model — not hand-authored numbers — produces the punchline: every pool
passes every week, combined allocation fails in mid-November, backlog pushes the final hire
~10 days past the deadline, and the cheapest fix (re-sequencing one req, zero added
interviewer capacity) beats training two extra System Design interviewers.

Built with Next.js. Deployed on Vercel.
