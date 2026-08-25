import { PlanModel } from "./types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export interface ScenarioDef {
  id: string;
  name: string;
  detail: string;
  tradeoff: string;
  apply: (model: PlanModel) => PlanModel;
}

// Re-sequence the last req: start sourcing N weeks earlier and spread the same
// candidate volume over a longer window (deadline unchanged). Adds zero
// interviewer capacity — it just moves demand off the late-horizon capacity cliff.
export function resequenceLastReq(model: PlanModel, weeksEarlier = 4, spreadWeeks = 7): PlanModel {
  const m = clone(model);
  const req = m.reqs[m.reqs.length - 1];
  req.startWeek = Math.max(0, req.startWeek - weeksEarlier);
  req.sourcingWeeks = spreadWeeks;
  return m;
}

// Cross-train N backend-only interviewers into the System Design pool.
export function trainSystemDesign(model: PlanModel, count = 2): PlanModel {
  const m = clone(model);
  let trained = 0;
  for (const iv of m.interviewers) {
    if (trained >= count) break;
    if (iv.pools.includes("backend") && !iv.pools.includes("sysdesign") && !iv.pools.includes("staffplus")) {
      iv.pools.push("sysdesign");
      trained++;
    }
  }
  return m;
}

// Raise the weekly cap of everyone in the Staff+ pool by 1 hour.
export function raiseStaffCap(model: PlanModel, extraHours = 1): PlanModel {
  const m = clone(model);
  for (const iv of m.interviewers) {
    if (iv.pools.includes("staffplus")) iv.weeklyCapHours += extraHours;
  }
  return m;
}

// Scale total hiring target across reqs proportionally (largest-remainder rounding).
export function setHiringTarget(model: PlanModel, newTotal: number): PlanModel {
  const m = clone(model);
  const oldTotal = m.reqs.reduce((a, r) => a + r.targetHires, 0);
  if (oldTotal === 0) return m;
  const exact = m.reqs.map((r) => (r.targetHires / oldTotal) * newTotal);
  const floors = exact.map(Math.floor);
  let remaining = newTotal - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i]++;
    remaining--;
  }
  m.reqs.forEach((r, i) => (r.targetHires = Math.max(0, floors[i])));
  return m;
}

export function buildScenarios(model: PlanModel): ScenarioDef[] {
  const lastReq = model.reqs[model.reqs.length - 1];
  const scenarios: ScenarioDef[] = [];
  if (model.reqs.length > 1 && lastReq.startWeek > 0) {
    scenarios.push({
      id: "resequence",
      name: `Start ${lastReq.id.split(" · ")[0]} 4 weeks earlier`,
      detail:
        "Same candidate volume, sourced earlier and spread over more weeks. Adds no interviewer capacity.",
      tradeoff: "Added capacity: none",
      apply: (m) => resequenceLastReq(m, 4, 7),
    });
  }
  scenarios.push({
    id: "train",
    name: "Train 2 System Design interviewers",
    detail: "Cross-trains 2 backend-only interviewers into the System Design pool.",
    tradeoff: "Requires: 2 interviewers trained",
    apply: (m) => trainSystemDesign(m, 2),
  });
  scenarios.push({
    id: "raisecap",
    name: "Raise Staff+ cap +1h/week",
    detail: "Everyone in the Staff+ pool takes one extra interview hour per week.",
    tradeoff: "Trade-off: higher senior interviewer load",
    apply: (m) => raiseStaffCap(m, 1),
  });
  return scenarios;
}
