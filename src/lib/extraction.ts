import { z } from "zod";
import { PlanModel, Provenance } from "@/engine/types";
import { POOL_LABELS, defaultStages, generateRoster, nextMonday, weekOf } from "@/data/defaults";

// What the LLM (or the heuristic fallback) extracts from the user's 2–3 lines.
// This is the ONLY thing the LLM produces — every forecast number downstream
// comes from the deterministic engine.
export const ExtractionSchema = z.object({
  reqs: z
    .array(
      z.object({
        role: z.string(),
        targetHires: z.number().int().min(1).max(200),
        label: z.string().nullable(),
        deadlineDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        startDelayWeeks: z.number().int().min(0).max(52).nullable(),
      })
    )
    .min(1)
    .max(8),
  interviewerCount: z.number().int().min(1).max(200).nullable(),
  funnelRates: z.array(
    z.object({
      stage: z.enum(["screen", "hm", "coding", "sysdesign", "behavioral"]),
      rate: z.number().min(0.05).max(1),
    })
  ),
  offerAcceptRate: z.number().min(0.05).max(1).nullable(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ParseResult {
  model: PlanModel;
  parser: "llm" | "heuristic";
  notes: string[];
}

// Deterministic mapping from extraction to a full PlanModel, filling gaps with
// labeled defaults. Nothing here is model-generated.
export function buildModelFromExtraction(
  ex: Extraction,
  now: Date,
  parser: "llm" | "heuristic"
): ParseResult {
  const notes: string[] = [];
  const planStartDate = nextMonday(now);
  const stages = defaultStages();

  for (const fr of ex.funnelRates) {
    const stage = stages.find((s) => s.id === fr.stage);
    if (stage) stage.passRate = { value: fr.rate, source: "provided" };
  }

  const offerAccept =
    ex.offerAcceptRate != null
      ? { value: ex.offerAcceptRate, source: "provided" as Provenance }
      : { value: 0.75, source: "assumed" as Provenance };
  if (ex.offerAcceptRate == null) notes.push("Offer acceptance not given, so 75% is assumed.");

  const fallbackDeadline = (() => {
    const d = new Date(planStartDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 12 * 7 + 4);
    return d.toISOString().slice(0, 10);
  })();

  const reqs = ex.reqs.map((r, i) => {
    let deadline = r.deadlineDate;
    if (deadline && weekOf(planStartDate, deadline) < 2) {
      notes.push(`Deadline ${deadline} is less than 2 weeks out, so it is treated as 12 weeks from now.`);
      deadline = null;
    }
    if (!deadline) {
      deadline = fallbackDeadline;
      if (r.deadlineDate == null) notes.push(`No deadline for ${r.role}, so 12 weeks out (${deadline}) is assumed.`);
    }
    return {
      id: r.label ? `Req ${i + 1} · ${r.label}` : `Req ${i + 1}`,
      role: r.role.replace(/\b\w/g, (c) => c.toUpperCase()),
      targetHires: r.targetHires,
      startWeek: Math.min(r.startDelayWeeks ?? 0, Math.max(0, weekOf(planStartDate, deadline) - 1)),
      deadlineWeek: weekOf(planStartDate, deadline),
      deadlineDate: deadline,
    };
  });

  const horizonWeeks = Math.max(8, Math.min(26, Math.max(...reqs.map((r) => r.deadlineWeek)) + 1));

  const engineerCount = ex.interviewerCount ?? 20;
  if (ex.interviewerCount == null) {
    notes.push("Interviewer count not given, so a 20-person roster was generated.");
  }
  notes.push(
    `The interviewer roster (panels, weekly caps, existing load, PTO) is a generated assumption. Edit it under Review assumptions.`
  );

  // Label the core-technical pool after the role being hired so a frontend or
  // data plan doesn't read "Backend" everywhere. Pool ids stay stable.
  const poolLabels = { ...POOL_LABELS };
  const role = reqs[0].role.toLowerCase();
  if (!role.includes("backend")) {
    const adj = reqs[0].role.replace(/\s*engineer.*$/i, "").trim();
    poolLabels.backend = adj ? `${adj} Technical` : "Core Technical";
  }

  const model: PlanModel = {
    planStartDate,
    horizonWeeks,
    reqs,
    stages,
    offerAccept,
    offerLagDays: { value: 10, source: "assumed" },
    bookingWasteRate: { value: 0.15, source: "assumed" },
    interviewers: generateRoster(engineerCount, horizonWeeks),
    rosterSource: "assumed",
    poolLabels,
  };

  return { model, parser, notes };
}

// Regex fallback so the demo still works with no ANTHROPIC_API_KEY configured.
export function heuristicExtract(text: string): Extraction {
  const t = text.toLowerCase();

  const hireMatch =
    t.match(/hire\s+(\d{1,3})\s+([a-z -]*?)(?:engineer|developer|designer|analyst|scientist)s?/) ??
    t.match(/(\d{1,3})\s+([a-z -]*?)(?:engineer|developer|designer|analyst|scientist)s?/);
  const target = hireMatch ? parseInt(hireMatch[1], 10) : 10;
  const roleAdj = hireMatch ? hireMatch[2].trim() : "";
  const role = (roleAdj ? roleAdj.replace(/\b\w/g, (c) => c.toUpperCase()) + " " : "") + "Engineer";

  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let deadline: string | null = null;
  const dm = t.match(/by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})/);
  if (dm) {
    const now = new Date();
    let year = now.getUTCFullYear();
    const month = months[dm[1]];
    const day = parseInt(dm[2], 10);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getTime() < now.getTime()) year += 1;
    deadline = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const ivMatch = t.match(/(\d{1,3})\s+interviewers?/);

  const funnelRates: Extraction["funnelRates"] = [];
  const rateOf = (re: RegExp) => {
    const m = t.match(re);
    return m ? parseInt(m[1], 10) / 100 : null;
  };
  const screen = rateOf(/screen[^%]*?(\d{1,2})\s*%/);
  if (screen) funnelRates.push({ stage: "screen", rate: screen });
  const sd = rateOf(/system design[^%]*?(\d{1,2})\s*%/);
  if (sd) funnelRates.push({ stage: "sysdesign", rate: sd });
  const coding = rateOf(/coding[^%]*?(\d{1,2})\s*%/);
  if (coding) funnelRates.push({ stage: "coding", rate: coding });
  const offerAccept = rateOf(/accept[a-z]*[^%]*?(\d{1,2})\s*%/);

  return {
    reqs: [
      {
        role,
        targetHires: target,
        label: null,
        deadlineDate: deadline,
        startDelayWeeks: 0,
      },
    ],
    interviewerCount: ivMatch ? parseInt(ivMatch[1], 10) : null,
    funnelRates,
    offerAcceptRate: offerAccept,
  };
}
