import { PlanModel, StageDef, WeeklyDemand } from "./types";

// Expected interviewer-hours consumed per candidate at a stage, per pool seat.
// Booked-slot waste is modeled as expected bookings per completed interview:
// to complete 1 interview with waste rate w, expected bookings = 1 / (1 - w).
export function stagePoolHours(stage: StageDef, wasteRate: number): Record<string, number> {
  const perSeatH = (stage.durationMin + stage.prepMin + stage.feedbackMin) / 60 / (1 - wasteRate);
  const out: Record<string, number> = {};
  for (const seat of stage.panel) {
    out[seat.pool] = (out[seat.pool] ?? 0) + seat.count * perSeatH;
  }
  return out;
}

// Survival probability from entering stage i to an accepted offer.
export function survivalFromStage(model: PlanModel, stageIdx: number): number {
  let p = model.offerAccept.value;
  for (let i = stageIdx; i < model.stages.length; i++) {
    p *= model.stages[i].passRate.value;
  }
  return p;
}

// Survival from top of funnel to entering stage i (probability a fresh candidate reaches stage i).
export function survivalToStage(model: PlanModel, stageIdx: number): number {
  let p = 1;
  for (let i = 0; i < stageIdx; i++) {
    p *= model.stages[i].passRate.value;
  }
  return p;
}

// Cumulative lag in days from entering the pipeline to sitting stage i.
export function cumLagDaysToStage(model: PlanModel, stageIdx: number): number {
  let days = 0;
  for (let i = 0; i < stageIdx; i++) {
    days += model.stages[i].lagDays.value;
  }
  return days;
}

// Weeks from entering the pipeline to an accepted offer landing, using the
// same floor-of-weeks arithmetic the simulation uses, plus one safety week.
export function pipelineWeeks(model: PlanModel): number {
  const lagToLastStage = cumLagDaysToStage(model, model.stages.length - 1);
  return Math.floor(lagToLastStage / 7) + Math.floor(model.offerLagDays.value / 7) + 1;
}

export interface ReqCadence {
  reqId: string;
  entrantsPerWeek: number[]; // [week] fresh candidates entering stage 0
  topOfFunnel: number;
}

// Backwards funnel math: candidates required at the top so that targetHires accepted offers land.
export function reqCadence(model: PlanModel, reqIdx: number): ReqCadence {
  const req = model.reqs[reqIdx];
  const topOfFunnel = req.targetHires / survivalFromStage(model, 0);
  const pw = pipelineWeeks(model);
  // Last week a candidate can enter and still clear the pipeline by the deadline.
  const lastEntry = Math.max(req.startWeek, req.deadlineWeek - pw);
  const windowEnd =
    req.sourcingWeeks != null
      ? Math.min(lastEntry, req.startWeek + req.sourcingWeeks - 1)
      : lastEntry;
  const windowLen = windowEnd - req.startWeek + 1;
  const perWeek = topOfFunnel / windowLen;
  const entrants = new Array(model.horizonWeeks).fill(0);
  for (let w = req.startWeek; w <= windowEnd && w < model.horizonWeeks; w++) {
    entrants[w] = perWeek;
  }
  return { reqId: req.id, entrantsPerWeek: entrants, topOfFunnel };
}

export function collectPoolIds(model: PlanModel): string[] {
  const ids: string[] = [];
  for (const s of model.stages) {
    for (const seat of s.panel) {
      if (!ids.includes(seat.pool)) ids.push(seat.pool);
    }
  }
  return ids;
}

// Unconstrained weekly demand: what the plan *wants* to happen each week,
// before any capacity limit is applied. Week-4-style spikes emerge from
// req stacking + funnel + lags, not manual assertion.
export function computeWeeklyDemand(model: PlanModel): WeeklyDemand {
  const poolIds = collectPoolIds(model);
  const W = model.horizonWeeks;
  const hoursByWeekPool: number[][] = Array.from({ length: W }, () => poolIds.map(() => 0));
  const candidatesByWeekStage: number[][] = Array.from({ length: W }, () =>
    model.stages.map(() => 0)
  );
  const entrantsByWeek = new Array(W).fill(0);
  const waste = model.bookingWasteRate.value;

  for (let r = 0; r < model.reqs.length; r++) {
    const cadence = reqCadence(model, r);
    for (let w0 = 0; w0 < W; w0++) {
      const entrants = cadence.entrantsPerWeek[w0];
      if (entrants <= 0) continue;
      entrantsByWeek[w0] += entrants;
      for (let s = 0; s < model.stages.length; s++) {
        const arriveWeek = w0 + Math.floor(cumLagDaysToStage(model, s) / 7);
        if (arriveWeek >= W) continue;
        const volume = entrants * survivalToStage(model, s);
        candidatesByWeekStage[arriveWeek][s] += volume;
        const poolHours = stagePoolHours(model.stages[s], waste);
        for (const [pool, h] of Object.entries(poolHours)) {
          const pi = poolIds.indexOf(pool);
          hoursByWeekPool[arriveWeek][pi] += volume * h;
        }
      }
    }
  }

  return { hoursByWeekPool, poolIds, candidatesByWeekStage, entrantsByWeek };
}
