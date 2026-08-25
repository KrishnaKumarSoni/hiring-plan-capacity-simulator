// Console test harness for the deterministic engine.
// Tiny datasets with hand-computable expected answers. Run: npm test

import { maxFlow } from "../maxflow";
import {
  computeWeeklyDemand,
  reqCadence,
  survivalFromStage,
} from "../demand";
import { computeWeeklySupply } from "../supply";
import { buildFeasibilityMatrix, checkWeek } from "../feasibility";
import { simulate } from "../simulate";
import { PlanModel, Sourced } from "../types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}
function approx(a: number, b: number, tol = 0.02) {
  return Math.abs(a - b) <= tol;
}
const src = <T>(value: T): Sourced<T> => ({ value, source: "provided" });

// ---------- 1. max-flow on a known graph ----------
console.log("\n[maxflow]");
{
  // classic: s->a(3), s->b(2), a->t(2), a->b(1), b->t(3)  => maxflow 5
  const cap = [
    [0, 3, 2, 0],
    [0, 0, 1, 2],
    [0, 0, 0, 3],
    [0, 0, 0, 0],
  ];
  const r = maxFlow(4, cap, 0, 3);
  check("known graph flow = 5", r.maxFlow === 5, `got ${r.maxFlow}`);
}

// ---------- helpers for tiny plan models ----------
function tinyModel(overrides: Partial<PlanModel> = {}): PlanModel {
  return {
    planStartDate: "2026-08-31",
    horizonWeeks: 6,
    reqs: [
      {
        id: "Req 1",
        role: "Engineer",
        targetHires: 4,
        startWeek: 0,
        deadlineWeek: 5,
        deadlineDate: "2026-10-05",
      },
    ],
    stages: [
      {
        id: "screen",
        name: "Screen",
        durationMin: 60,
        prepMin: 0,
        feedbackMin: 0,
        panel: [{ pool: "a", count: 1 }],
        passRate: src(0.5),
        lagDays: src(0),
      },
    ],
    offerAccept: src(1),
    offerLagDays: src(0),
    bookingWasteRate: src(0),
    interviewers: [
      {
        id: "x",
        name: "X",
        pools: ["a"],
        weeklyCapHours: 10,
        existingLoadHours: {},
        ptoWeeks: [],
      },
    ],
    rosterSource: "provided",
    poolLabels: { a: "Pool A", b: "Pool B" },
    ...overrides,
  };
}

// ---------- 2. backwards funnel ----------
console.log("\n[backwards funnel]");
{
  const m = tinyModel();
  // 4 hires / (0.5 pass * 1.0 accept) = 8 candidates at top
  check("survival from stage 0 = 0.5", approx(survivalFromStage(m, 0), 0.5));
  const cad = reqCadence(m, 0);
  check("top of funnel = 8", approx(cad.topOfFunnel, 8));
  const total = cad.entrantsPerWeek.reduce((a, b) => a + b, 0);
  check("entrants sum to top of funnel", approx(total, 8));
}

// ---------- 3. overlapping pools: independent PASS, combined FAIL ----------
console.log("\n[overlap max-flow]");
{
  // Two pools, one week. Demand: A=2h, B=2h.
  // X is in both pools (cap 2h), Y only in A (cap 2h).
  // Apparent: A=4h>=2 ok, B=2h>=2 ok. Unique capacity for {A,B}=4h >= 4h combined -> feasible.
  const m = tinyModel({
    interviewers: [
      { id: "x", name: "X", pools: ["a", "b"], weeklyCapHours: 2, existingLoadHours: {}, ptoWeeks: [] },
      { id: "y", name: "Y", pools: ["a"], weeklyCapHours: 2, existingLoadHours: {}, ptoWeeks: [] },
    ],
  });
  const r1 = checkWeek(m, ["a", "b"], [2, 2], [2, 2]);
  check("exact-fit week is feasible", r1.ok);

  // Now B demand = 3h. B apparent = 2 < 3 (independent fail too). Instead keep
  // independent passing: X cap 3, Y cap 2. A apparent=5>=2, B apparent=3>=3.
  // Combined demand 5, unique cap 5 -> feasible. Then X loses 1h to existing load:
  // A apparent=4>=2 ok, B apparent=2<3 ... still independent fail. Use PTO-free trick:
  // demand A=2,B=2; X cap 3 load 2 -> residual 1; Y cap 2.
  // A apparent=3>=2 ok, B apparent=1<2 independent FAIL (fine, different case).
  // The canonical overlap case: A=2, B=2, X residual 2, Y residual 1:
  // A apparent = 3 >= 2 ok; B apparent = 2 >= 2 ok; combined 4 > unique 3 -> FAIL.
  const r2 = checkWeek(m, ["a", "b"], [2, 2], [2, 1]);
  check("overlap makes combined infeasible", !r2.ok);
  check("shortfall = 1h", r2.diagnosis !== null && approx(r2.diagnosis!.shortfallH, 1));
  check(
    "X flagged as overlap person",
    r2.diagnosis !== null && r2.diagnosis!.overlapPeople.some((p) => p.name === "X")
  );
  check(
    "bottleneck includes both pools",
    r2.diagnosis !== null && r2.diagnosis!.unmetPools.length === 2
  );
}

// ---------- 4. capacity is perishable ----------
console.log("\n[perishable capacity]");
{
  // Demand 8h in week 0 only (all 8 candidates enter W0); capacity 4h/week over 6 weeks.
  // Total capacity 24h >> 8h demand, but W0 alone fails.
  const m = tinyModel({
    reqs: [
      { id: "Req 1", role: "Engineer", targetHires: 4, startWeek: 0, deadlineWeek: 0, deadlineDate: "2026-08-31" },
    ],
    interviewers: [
      { id: "x", name: "X", pools: ["a"], weeklyCapHours: 4, existingLoadHours: {}, ptoWeeks: [] },
    ],
  });
  const demand = computeWeeklyDemand(m);
  const supply = computeWeeklySupply(m);
  check("W0 demand = 8h", approx(demand.hoursByWeekPool[0][0], 8));
  const matrix = buildFeasibilityMatrix(m, demand, supply);
  check("W0 combined FAIL despite total surplus", !matrix.combinedOk[0]);
  const totalCap = supply.totalByWeek.reduce((a, b) => a + b, 0);
  check("total capacity exceeds total demand", totalCap >= 8);
}

// ---------- 5. backlog moves completion ----------
console.log("\n[backlog and slip]");
{
  // Same squeezed plan: 8h demand W0, 4h/week capacity. Interviews half-served in W0,
  // remainder backlogged into W1. 4 hires need all 8 candidates screened; last screens
  // happen W1, so completion lands in W1 — after the W0 deadline.
  const m = tinyModel({
    reqs: [
      { id: "Req 1", role: "Engineer", targetHires: 4, startWeek: 0, deadlineWeek: 0, deadlineDate: "2026-09-04" },
    ],
    interviewers: [
      { id: "x", name: "X", pools: ["a"], weeklyCapHours: 4, existingLoadHours: {}, ptoWeeks: [] },
    ],
  });
  const sim = simulate(m);
  check("W0 backlog = 4h", approx(sim.weeks[0].backlogH, 4));
  check("hires by deadline = 2", sim.hiresByDeadline === 2, `got ${sim.hiresByDeadline}`);
  check("final hire lands W1", sim.finalHireWeek === 1, `got ${sim.finalHireWeek}`);
  check("slip > 0 days", sim.slipDays > 0, `got ${sim.slipDays}`);

  // Double the capacity -> everything served in W0, no slip vs a Friday deadline.
  const m2 = tinyModel({
    reqs: [
      { id: "Req 1", role: "Engineer", targetHires: 4, startWeek: 0, deadlineWeek: 0, deadlineDate: "2026-09-04" },
    ],
    interviewers: [
      { id: "x", name: "X", pools: ["a"], weeklyCapHours: 8, existingLoadHours: {}, ptoWeeks: [] },
    ],
  });
  const sim2 = simulate(m2);
  check("with enough capacity, no slip", sim2.slipDays === 0, `got ${sim2.slipDays}`);
  check("backlog empty", approx(sim2.weeks[0].backlogH, 0));
}

// ---------- 6. PTO and existing load ----------
console.log("\n[pto + weekly load]");
{
  const m = tinyModel({
    interviewers: [
      {
        id: "x",
        name: "X",
        pools: ["a"],
        weeklyCapHours: 5,
        existingLoadHours: { 1: 2 },
        ptoWeeks: [2],
      },
    ],
  });
  const supply = computeWeeklySupply(m);
  check("W0 residual = 5", approx(supply.totalByWeek[0], 5));
  check("W1 residual = 3 (existing load)", approx(supply.totalByWeek[1], 3));
  check("W2 residual = 0 (PTO)", approx(supply.totalByWeek[2], 0));
}

// ---------- 7. lag shifts demand week ----------
console.log("\n[stage lag]");
{
  const twoStage = (lagDays: number): PlanModel =>
    tinyModel({
      horizonWeeks: 8,
      reqs: [
        { id: "Req 1", role: "Engineer", targetHires: 2, startWeek: 0, deadlineWeek: 0, deadlineDate: "2026-08-31" },
      ],
      stages: [
        {
          id: "s1",
          name: "S1",
          durationMin: 60,
          prepMin: 0,
          feedbackMin: 0,
          panel: [{ pool: "a", count: 1 }],
          passRate: src(1),
          lagDays: src(lagDays),
        },
        {
          id: "s2",
          name: "S2",
          durationMin: 60,
          prepMin: 0,
          feedbackMin: 0,
          panel: [{ pool: "b", count: 1 }],
          passRate: src(1),
          lagDays: src(0),
        },
      ],
      interviewers: [
        { id: "x", name: "X", pools: ["a", "b"], weeklyCapHours: 40, existingLoadHours: {}, ptoWeeks: [] },
      ],
    });
  const d0 = computeWeeklyDemand(twoStage(0));
  const d14 = computeWeeklyDemand(twoStage(14));
  const bIdx = d0.poolIds.indexOf("b");
  check("lag 0: stage-2 demand in W0", d0.hoursByWeekPool[0][bIdx] > 0);
  check("lag 14d: stage-2 demand moved to W2", d14.hoursByWeekPool[2][bIdx] > 0 && approx(d14.hoursByWeekPool[0][bIdx], 0));
}

console.log(failures === 0 ? "\nAll engine tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
