import { AnalysisResult, PlanModel } from "./types";
import { computeWeeklyDemand } from "./demand";
import { computeWeeklySupply, uniquePoolSetCapacity } from "./supply";
import { buildFeasibilityMatrix } from "./feasibility";
import { simulate } from "./simulate";

export * from "./types";
export * from "./demand";
export * from "./supply";
export * from "./feasibility";
export * from "./simulate";
export * from "./scenarios";
export * from "./sensitivity";

// Peak load on a set of pools: served hours in those pools vs the unique
// capacity of the humans eligible for them, week by week.
export function peakPoolSetLoad(
  model: PlanModel,
  sim: import("./types").SimResult,
  pools: string[]
): number {
  let peak = 0;
  for (const wk of sim.weeks) {
    const cap = uniquePoolSetCapacity(model, pools, wk.week);
    if (cap <= 0) continue;
    const served = pools.reduce((a, p) => a + (wk.servedHByPool[p] ?? 0), 0);
    peak = Math.max(peak, served / cap);
  }
  return peak;
}

export function analyze(model: PlanModel): AnalysisResult {
  const demand = computeWeeklyDemand(model);
  const supply = computeWeeklySupply(model);
  const matrix = buildFeasibilityMatrix(model, demand, supply);
  const sim = simulate(model);

  const totalDemandH = demand.hoursByWeekPool.flat().reduce((a, b) => a + b, 0);
  const totalCapacityH = supply.totalByWeek.reduce((a, b) => a + b, 0);
  const firstFail = matrix.combinedOk.findIndex((ok) => !ok);

  return {
    demand,
    supply,
    matrix,
    sim,
    summary: {
      totalTarget: sim.totalTarget,
      role: model.reqs[0].role,
      deadlineDate: sim.deadlineDate,
      totalDemandH,
      totalCapacityH,
      totalCapacityOk: totalCapacityH >= totalDemandH,
      allocationOk: matrix.combinedOk.every(Boolean),
      firstFailWeek: firstFail === -1 ? null : firstFail,
    },
  };
}
