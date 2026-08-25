import { PlanModel, WeeklySupply } from "./types";
import { collectPoolIds } from "./demand";

// Residual capacity per interviewer per week: weekly cap minus existing
// commitments, zeroed on PTO weeks. Never aggregated across the horizon —
// capacity is perishable.
export function residualHours(model: PlanModel, interviewerIdx: number, week: number): number {
  const iv = model.interviewers[interviewerIdx];
  if (iv.ptoWeeks.includes(week)) return 0;
  const load = iv.existingLoadHours[week] ?? 0;
  return Math.max(0, iv.weeklyCapHours - load);
}

// Unique (non-double-counted) capacity of everyone eligible for any pool in the set.
export function uniquePoolSetCapacity(model: PlanModel, pools: string[], week: number): number {
  return model.interviewers.reduce(
    (sum, iv, i) =>
      sum + (iv.pools.some((p) => pools.includes(p)) ? residualHours(model, i, week) : 0),
    0
  );
}

export function computeWeeklySupply(model: PlanModel): WeeklySupply {
  const poolIds = collectPoolIds(model);
  const W = model.horizonWeeks;
  const residualByWeekInterviewer: number[][] = [];
  const apparentByWeekPool: number[][] = [];
  const totalByWeek: number[] = [];

  for (let w = 0; w < W; w++) {
    const residuals = model.interviewers.map((_, i) => residualHours(model, i, w));
    residualByWeekInterviewer.push(residuals);
    totalByWeek.push(residuals.reduce((a, b) => a + b, 0));
    // Apparent per-pool capacity: the naive view that double-counts people
    // who belong to multiple pools. Kept deliberately so the contradiction
    // between per-pool checks and max-flow is visible.
    apparentByWeekPool.push(
      poolIds.map((pool) =>
        model.interviewers.reduce(
          (sum, iv, i) => sum + (iv.pools.includes(pool) ? residuals[i] : 0),
          0
        )
      )
    );
  }

  return { apparentByWeekPool, residualByWeekInterviewer, poolIds, totalByWeek };
}
