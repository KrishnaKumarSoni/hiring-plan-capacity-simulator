import { PlanModel, SimResult, SimWeek } from "./types";
import {
  collectPoolIds,
  cumLagDaysToStage,
  reqCadence,
  stagePoolHours,
} from "./demand";
import { residualHours } from "./supply";
import { maxFlow } from "./maxflow";

const toMin = (h: number) => Math.round(h * 60);
// Demand nodes use ceil so sub-minute fractional-candidate crumbs still get a
// nonzero allocation edge — otherwise they'd sit in the queue forever.
const toMinDemand = (h: number) => Math.ceil(h * 60);
const EXTRA_WEEKS = 30; // simulate past the horizon so backlog can drain
// The continuous-expectation model approaches the target asymptotically; the
// "final hire" is called at target minus this tolerance (2% of one hire).
const FINAL_TOL = 0.02;

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekToDate(model: PlanModel, week: number, dayOffset = 0): string {
  return isoAddDays(model.planStartDate, week * 7 + dayOffset);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000
  );
}

// Constrained week-by-week pipeline simulation.
// Candidates queue at each stage; each week a max-flow allocation decides how
// many interviews each stage can actually run given shared interviewer pools.
// Unserved candidates stay in the queue (backlog) and carry forward, which is
// what ultimately moves the projected completion date.
export function simulate(model: PlanModel): SimResult {
  const poolIds = collectPoolIds(model);
  const S = model.stages.length;
  const W = model.horizonWeeks + EXTRA_WEEKS;
  const waste = model.bookingWasteRate.value;
  const stageHours = model.stages.map((s) => stagePoolHours(s, waste));
  const stageTotalHoursPerCand = stageHours.map((ph) =>
    Object.values(ph).reduce((a, b) => a + b, 0)
  );

  // arrivals[w][s] = candidates arriving at stage s in week w
  const arrivals: number[][] = Array.from({ length: W + 8 }, () => new Array(S).fill(0));
  for (let r = 0; r < model.reqs.length; r++) {
    const cad = reqCadence(model, r);
    for (let w = 0; w < model.horizonWeeks; w++) {
      if (cad.entrantsPerWeek[w] > 0) arrivals[w][0] += cad.entrantsPerWeek[w];
    }
  }

  const lagWeeksTo = (s: number) => Math.floor(cumLagDaysToStage(model, s) / 7);
  const offerLagWeeks = Math.floor(model.offerLagDays.value / 7);

  const queue = new Array(S).fill(0);
  const hiresLandingByWeek = new Array(W + 12).fill(0); // fractional accepted hires
  const weeks: SimWeek[] = [];
  const I = model.interviewers.length;

  for (let w = 0; w < W; w++) {
    for (let s = 0; s < S; s++) queue[s] += arrivals[w][s];

    // Build per-(stage,pool) demand nodes so served hours map back to candidates.
    type Node = { stage: number; pool: string; demandH: number };
    const nodes: Node[] = [];
    for (let s = 0; s < S; s++) {
      if (queue[s] <= 1e-9) continue;
      for (const [pool, hPerCand] of Object.entries(stageHours[s])) {
        nodes.push({ stage: s, pool, demandH: queue[s] * hPerCand });
      }
    }
    const residuals = model.interviewers.map((_, i) => residualHours(model, i, w));
    const capacityH = residuals.reduce((a, b) => a + b, 0);

    const n = 1 + I + nodes.length + 1;
    const source = 0;
    const sink = n - 1;
    const cap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < I; i++) {
      cap[source][1 + i] = toMin(residuals[i]);
      for (let k = 0; k < nodes.length; k++) {
        if (model.interviewers[i].pools.includes(nodes[k].pool)) {
          cap[1 + i][1 + I + k] = Number.MAX_SAFE_INTEGER;
        }
      }
    }
    for (let k = 0; k < nodes.length; k++) {
      cap[1 + I + k][sink] = toMinDemand(nodes[k].demandH);
    }

    const res = maxFlow(n, cap, source, sink);

    // Candidates actually interviewed per stage = the binding pool seat
    const demandH = nodes.reduce((a, b) => a + b.demandH, 0);
    let servedH = 0;
    const servedHByPool: Record<string, number> = {};
    for (let s = 0; s < S; s++) {
      if (queue[s] <= 1e-9) continue;
      // Candidates who joined this queue after allocation ran (same-week lag
      // hops) were not part of this week's flow graph — they wait for next
      // week rather than advancing without consuming interviewer capacity.
      if (!nodes.some((nd) => nd.stage === s)) continue;
      let interviewed = queue[s];
      for (let k = 0; k < nodes.length; k++) {
        if (nodes[k].stage !== s) continue;
        let inflow = 0;
        for (let i = 0; i < I; i++) inflow += res.flow[1 + i][1 + I + k];
        const hPerCand = stageHours[s][nodes[k].pool];
        interviewed = Math.min(interviewed, inflow / 60 / hPerCand);
      }
      servedH += interviewed * stageTotalHoursPerCand[s];
      for (const [pool, hPerCand] of Object.entries(stageHours[s])) {
        servedHByPool[pool] = (servedHByPool[pool] ?? 0) + interviewed * hPerCand;
      }
      queue[s] -= interviewed;
      const passed = interviewed * model.stages[s].passRate.value;
      if (s + 1 < S) {
        const delta = Math.max(0, lagWeeksTo(s + 1) - lagWeeksTo(s));
        // Same-week lag: candidates join the next stage's queue directly.
        // (They were not part of this week's allocation, so they are served
        // starting next week — you can't sit two loop stages simultaneously.)
        if (delta === 0) queue[s + 1] += passed;
        else if (w + delta < arrivals.length) arrivals[w + delta][s + 1] += passed;
      } else {
        const landW = w + Math.max(0, offerLagWeeks);
        if (landW < hiresLandingByWeek.length) {
          hiresLandingByWeek[landW] += passed * model.offerAccept.value;
        }
      }
    }

    const backlogH = queue.reduce((sum, q, s) => sum + q * stageTotalHoursPerCand[s], 0);
    weeks.push({
      week: w,
      demandH,
      servedH,
      backlogH,
      capacityH,
      servedHByPool,
      utilization: capacityH > 0 ? servedH / capacityH : 0,
      hiresLanded: 0, // filled below
    });
  }

  const totalTarget = model.reqs.reduce((a, r) => a + r.targetHires, 0);
  const deadlineDate = model.reqs.reduce(
    (latest, r) => (r.deadlineDate > latest ? r.deadlineDate : latest),
    model.reqs[0].deadlineDate
  );
  const deadlineWeek = Math.max(...model.reqs.map((r) => r.deadlineWeek));

  // 1e-4 epsilon: dozens of fractional multiplications otherwise leave the
  // cumulative total at target-minus-1e-9 and "the last hire never lands".
  const EPS = 1e-4;
  let cum = 0;
  const cumByWeek: number[] = [];
  for (let w = 0; w < W; w++) {
    cum += hiresLandingByWeek[w];
    cumByWeek.push(cum);
    weeks[w].hiresLanded = Math.floor(cum + EPS);
  }

  // Day-accurate count at the deadline: hires landing in the deadline week are
  // spread across its 5 workdays, so a Tuesday deadline only credits 2/5 of them.
  const dw = Math.min(deadlineWeek, W - 1);
  const weekStart = weekToDate(model, dw);
  const dayInWeek = Math.max(0, Math.min(4, daysBetween(weekStart, deadlineDate)));
  const prevCumAtDeadline = dw > 0 ? cumByWeek[dw - 1] : 0;
  const gainedInDeadlineWeek = (cumByWeek[dw] ?? 0) - prevCumAtDeadline;
  const hiresByDeadline = Math.min(
    totalTarget,
    Math.floor(prevCumAtDeadline + (gainedInDeadlineWeek * (dayInWeek + 1)) / 5 + EPS)
  );

  let finalHireWeek: number | null = null;
  let finalHireDate: string | null = null;
  for (let w = 0; w < W; w++) {
    if (cumByWeek[w] >= totalTarget - FINAL_TOL) {
      finalHireWeek = w;
      const prev = w > 0 ? cumByWeek[w - 1] : 0;
      const gained = cumByWeek[w] - prev;
      const frac = gained > 1e-9 ? Math.min(1, (totalTarget - prev) / gained) : 1;
      finalHireDate = weekToDate(model, w, Math.min(4, Math.floor(frac * 5)));
      break;
    }
  }

  const slipDays =
    finalHireDate !== null ? Math.max(0, daysBetween(deadlineDate, finalHireDate)) : 999;

  // Peak utilization within the active hiring window (ignore drained tail weeks)
  let peakUtilization = 0;
  for (let w = 0; w <= Math.min(deadlineWeek + 4, W - 1); w++) {
    peakUtilization = Math.max(peakUtilization, weeks[w].utilization);
  }

  return {
    weeks,
    hiresByDeadline,
    totalTarget,
    finalHireWeek,
    finalHireDate,
    slipDays,
    peakUtilization,
    deadlineDate,
    onTime: slipDays === 0,
  };
}
