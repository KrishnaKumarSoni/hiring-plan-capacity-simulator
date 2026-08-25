import { FeasibilityMatrix, PlanModel, WeekDiagnosis, WeeklyDemand, WeeklySupply } from "./types";
import { maxFlow } from "./maxflow";

// Scale hours to integer minutes for exact flow arithmetic.
const toMin = (h: number) => Math.round(h * 60);

// Per-week allocation graph:
//   source -> interviewer (residual minutes) -> pool (if eligible) -> sink (demand minutes)
// The week is capacity-feasible iff max flow == total demand.
//
// Diagnosis uses the min cut: pools unreachable from the source in the residual
// graph form the bottleneck set T. Every interviewer eligible for a T-pool is
// provably also on the T side, so:
//   shortfall = (combined demand of T-pools) - (unique capacity of their interviewers)
// This is exactly the "pools look fine independently, but they share humans" failure.
export function checkWeek(
  model: PlanModel,
  poolIds: string[],
  demandByPool: number[],
  residuals: number[]
): { ok: boolean; servedByPool: number[]; diagnosis: WeekDiagnosis | null; week?: number } {
  const I = model.interviewers.length;
  const P = poolIds.length;
  const n = 1 + I + P + 1;
  const source = 0;
  const sink = n - 1;
  const cap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < I; i++) {
    cap[source][1 + i] = toMin(residuals[i]);
    for (let p = 0; p < P; p++) {
      if (model.interviewers[i].pools.includes(poolIds[p])) {
        cap[1 + i][1 + I + p] = Number.MAX_SAFE_INTEGER;
      }
    }
  }
  const demandMin = demandByPool.map(toMin);
  const totalDemand = demandMin.reduce((a, b) => a + b, 0);
  for (let p = 0; p < P; p++) {
    cap[1 + I + p][sink] = demandMin[p];
  }

  const res = maxFlow(n, cap, source, sink);
  const servedByPool = poolIds.map((_, p) => {
    let inflow = 0;
    for (let i = 0; i < I; i++) inflow += res.flow[1 + i][1 + I + p];
    return inflow / 60;
  });
  const ok = res.maxFlow >= totalDemand;
  if (ok) return { ok, servedByPool, diagnosis: null };

  // Bottleneck pool set from the min cut
  const bottleneckPools = poolIds.filter((_, p) => !res.reachable[1 + I + p] && demandMin[p] > 0);
  const bottleneckInterviewers = model.interviewers
    .map((iv, i) => ({ iv, i }))
    .filter(({ iv }) => iv.pools.some((pl) => bottleneckPools.includes(pl)));

  const combinedDemandH =
    bottleneckPools.reduce((sum, pl) => sum + demandMin[poolIds.indexOf(pl)], 0) / 60;
  const uniqueCapH = bottleneckInterviewers.reduce((sum, { i }) => sum + residuals[i], 0);

  const diagnosis: WeekDiagnosis = {
    week: -1, // filled by caller
    poolRows: [],
    unmetPools: bottleneckPools,
    combinedDemandH,
    uniqueCapH,
    shortfallH: Math.max(0, combinedDemandH - uniqueCapH),
    servedH: res.maxFlow / 60,
    overlapPeople: bottleneckInterviewers
      .filter(({ iv }) => iv.pools.filter((pl) => bottleneckPools.includes(pl)).length >= 2)
      .map(({ iv, i }) => ({
        name: iv.name,
        pools: iv.pools.filter((pl) => bottleneckPools.includes(pl)),
        residualH: residuals[i],
      })),
  };
  return { ok, servedByPool, diagnosis };
}

export function buildFeasibilityMatrix(
  model: PlanModel,
  demand: WeeklyDemand,
  supply: WeeklySupply
): FeasibilityMatrix {
  const poolIds = demand.poolIds;
  const W = model.horizonWeeks;
  const cells = poolIds.map((_, p) =>
    Array.from({ length: W }, (_, w) => {
      const d = demand.hoursByWeekPool[w][p];
      const c = supply.apparentByWeekPool[w][p];
      return { demandH: d, apparentCapH: c, ok: c >= d - 1e-9 };
    })
  );

  const combinedOk: boolean[] = [];
  const diagnoses: WeekDiagnosis[] = [];
  for (let w = 0; w < W; w++) {
    const { ok, diagnosis } = checkWeek(
      model,
      poolIds,
      demand.hoursByWeekPool[w],
      supply.residualByWeekInterviewer[w]
    );
    combinedOk.push(ok);
    if (diagnosis) {
      diagnosis.week = w;
      diagnosis.poolRows = poolIds.map((pool, p) => ({
        pool,
        demandH: demand.hoursByWeekPool[w][p],
        apparentCapH: supply.apparentByWeekPool[w][p],
        ok: cells[p][w].ok,
      }));
      diagnoses.push(diagnosis);
    }
  }

  return { poolIds, cells, combinedOk, diagnoses };
}
