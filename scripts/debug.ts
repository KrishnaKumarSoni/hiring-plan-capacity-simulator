// Debug harness: inspect every number the sample plan produces.
// Run: npx tsx scripts/debug.ts

import { analyze, simulate, weekToDate } from "../src/engine";
import { buildScenarios, setHiringTarget } from "../src/engine/scenarios";
import { runSensitivity } from "../src/engine/sensitivity";
import { buildSampleModel } from "../src/data/sample";

const model = buildSampleModel();
const res = analyze(model);
const f = (x: number) => x.toFixed(1).padStart(6);

console.log("=== SUMMARY ===");
console.log(res.summary);
console.log("deadline:", res.sim.deadlineDate, "| hires by deadline:", res.sim.hiresByDeadline, "/", res.sim.totalTarget);
console.log("final hire:", res.sim.finalHireDate, `(week ${res.sim.finalHireWeek})`, "| slip:", res.sim.slipDays, "days");
console.log("peak utilization:", (res.sim.peakUtilization * 100).toFixed(0) + "%");

console.log("\n=== WEEKLY DEMAND (hours by pool) ===");
console.log("wk   " + res.demand.poolIds.map((p) => p.padStart(10)).join(""));
for (let w = 0; w < model.horizonWeeks; w++) {
  console.log(
    String(w).padStart(2) +
      "   " +
      res.demand.hoursByWeekPool[w].map((h) => f(h).padStart(10)).join("") +
      "   | entrants " + res.demand.entrantsByWeek[w].toFixed(1)
  );
}

console.log("\n=== APPARENT SUPPLY (hours by pool) + unique total ===");
for (let w = 0; w < model.horizonWeeks; w++) {
  console.log(
    String(w).padStart(2) +
      "   " +
      res.supply.apparentByWeekPool[w].map((h) => f(h).padStart(10)).join("") +
      "   | unique " + res.supply.totalByWeek[w].toFixed(1)
  );
}

console.log("\n=== FEASIBILITY MATRIX ===");
console.log("pool          " + Array.from({ length: model.horizonWeeks }, (_, w) => String(w).padStart(3)).join(""));
res.matrix.poolIds.forEach((p, pi) => {
  console.log(
    p.padEnd(14) + res.matrix.cells[pi].map((c) => (c.ok ? "  .".padStart(3) : "  X")).join("")
  );
});
console.log("COMBINED      " + res.matrix.combinedOk.map((ok) => (ok ? "  ." : "  X")).join(""));

console.log("\n=== DIAGNOSES ===");
for (const d of res.matrix.diagnoses) {
  console.log(`Week ${d.week} (${weekToDate(model, d.week)}): unmet pools = ${d.unmetPools.join(", ")}`);
  console.log(`  combined demand ${d.combinedDemandH.toFixed(1)}h vs unique cap ${d.uniqueCapH.toFixed(1)}h -> shortfall ${d.shortfallH.toFixed(1)}h (served ${d.servedH.toFixed(1)}h)`);
  for (const row of d.poolRows.filter((r) => d.unmetPools.includes(r.pool))) {
    console.log(`    ${row.pool}: demand ${row.demandH.toFixed(1)}h, apparent ${row.apparentCapH.toFixed(1)}h, independent ${row.ok ? "PASS" : "FAIL"}`);
  }
  console.log(`  overlap people: ${d.overlapPeople.map((p) => `${p.name}(${p.pools.join("+")},${p.residualH}h)`).join(", ")}`);
}

console.log("\n=== SIM (demand/served/backlog/util/hires) ===");
for (const w of res.sim.weeks.slice(0, model.horizonWeeks + 6)) {
  console.log(
    `w${String(w.week).padStart(2)}  dem ${f(w.demandH)}  srv ${f(w.servedH)}  bkl ${f(w.backlogH)}  cap ${f(w.capacityH)}  util ${(w.utilization * 100).toFixed(0).padStart(3)}%  hires ${w.hiresLanded}`
  );
}

console.log("\n=== SCENARIOS ===");
for (const sc of buildScenarios(model)) {
  const m2 = sc.apply(model);
  const r2 = analyze(m2);
  console.log(
    `${sc.name}: hires by deadline ${r2.sim.hiresByDeadline}/${r2.sim.totalTarget}, final ${r2.sim.finalHireDate}, slip ${r2.sim.slipDays}d, peak ${(r2.sim.peakUtilization * 100).toFixed(0)}%, fail weeks ${r2.matrix.combinedOk.filter((x) => !x).length}`
  );
}

console.log("\n=== TARGET SWEEP ===");
for (const t of [10, 12, 14, 16, 18]) {
  const r2 = analyze(setHiringTarget(model, t));
  console.log(`target ${t}: by deadline ${r2.sim.hiresByDeadline}, final ${r2.sim.finalHireDate}, slip ${r2.sim.slipDays}d`);
}

console.log("\n=== SENSITIVITY ===");
for (const line of runSensitivity(model)) {
  console.log(
    `${line.label}: ${(line.baseRate * 100).toFixed(0)}% -> ${(line.altRate * 100).toFixed(0)}%: slip ${line.baseSlipDays}d -> ${line.altSlipDays}d (final ${line.baseFinalHireDate} -> ${line.altFinalHireDate})`
  );
}
