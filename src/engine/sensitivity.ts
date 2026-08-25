import { PlanModel } from "./types";
import { simulate } from "./simulate";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export interface SensitivityLine {
  label: string;
  baseRate: number;
  altRate: number;
  baseSlipDays: number;
  altSlipDays: number;
  baseFinalHireDate: string | null;
  altFinalHireDate: string | null;
  note?: string;
}

// Deliberate perturbations, each a full deterministic rerun — the forecast is
// a function of explicit assumptions, not a prophecy.
export function runSensitivity(model: PlanModel): SensitivityLine[] {
  const base = simulate(model);
  const lines: SensitivityLine[] = [];

  // 1. Offer acceptance −15 pts: inflates required volume at *every* stage.
  {
    const alt = clone(model);
    const r0 = alt.offerAccept.value;
    alt.offerAccept.value = Math.max(0.05, r0 - 0.15);
    const s = simulate(alt);
    lines.push({
      label: "Offer acceptance",
      baseRate: r0,
      altRate: alt.offerAccept.value,
      baseSlipDays: base.slipDays,
      altSlipDays: s.slipDays,
      baseFinalHireDate: base.finalHireDate,
      altFinalHireDate: s.finalHireDate,
    });
  }

  // 2. First-stage conversion −10 pts. Under a target-anchored backwards
  // funnel this widens the top (more screens) but leaves later-stage volumes
  // unchanged — a non-obvious property worth showing rather than hiding.
  {
    const alt = clone(model);
    const r0 = alt.stages[0].passRate.value;
    alt.stages[0].passRate.value = Math.max(0.05, r0 - 0.1);
    const s = simulate(alt);
    lines.push({
      label: `${model.stages[0].name} conversion`,
      baseRate: r0,
      altRate: alt.stages[0].passRate.value,
      baseSlipDays: base.slipDays,
      altSlipDays: s.slipDays,
      baseFinalHireDate: base.finalHireDate,
      altFinalHireDate: s.finalHireDate,
      note:
        "With the hiring target fixed, a worse top-of-funnel rate adds screening volume but does not change later-stage interview demand.",
    });
  }

  return lines;
}
