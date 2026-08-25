import { Interviewer, PlanModel } from "@/engine/types";
import { POOL_LABELS, defaultStages, s } from "./defaults";

export const SAMPLE_TEXT = `Hire 12 backend engineers by Dec 15 across three reqs — Platform (5), Infra (3), and Payments (4, approved to start sourcing mid-October).
We have 20 interviewers across Backend, System Design, and Staff+ panels; several carry other teams' loops, plus normal Nov–Dec PTO.
Recruiter screen → HM conversion is 60%; System Design → Behavioral is 70%.`;

// The sample org. Numbers are synthetic but internally consistent; the engine
// is never rigged backwards from a desired conclusion — this roster simply has
// the (very common) property that System Design and Staff+ are mostly the same
// senior people, with real Nov–Dec PTO and other-team interview commitments.
function sampleRoster(): Interviewer[] {
  const iv = (
    id: string,
    name: string,
    pools: string[],
    cap: number,
    load: Record<number, number> = {},
    pto: number[] = []
  ): Interviewer => ({
    id,
    name,
    pools,
    weeklyCapHours: cap,
    existingLoadHours: load,
    ptoWeeks: pto,
  });

  return [
    // Recruiting team
    iv("rec1", "Nisha Patel", ["recruiter"], 8, { 6: 1 }),
    iv("rec2", "Tom Okafor", ["recruiter"], 8, {}, [12]),
    iv("rec3", "Elena Rodrigues", ["recruiter"], 8, { 2: 1 }),
    // Hiring managers
    iv("hm1", "Marcus Webb", ["hm"], 7, { 3: 1, 8: 1 }),
    iv("hm2", "Devika Rao", ["hm"], 7, { 5: 1 }),
    iv("hm3", "James Liu", ["hm"], 7, {}, [13]),
    // Backend-only interviewers (13)
    iv("be1", "Sam Torres", ["backend"], 3, { 4: 1 }),
    iv("be2", "Lucia Ferreira", ["backend"], 3, { 1: 0.5, 9: 1 }),
    iv("be3", "Chen Wei", ["backend"], 3, { 9: 1 }),
    iv("be4", "Omar Haddad", ["backend"], 3, { 2: 1 }),
    iv("be5", "Tanvi Desai", ["backend"], 3, { 6: 0.5 }),
    iv("be6", "Jake Miller", ["backend"], 3, {}, [12]),
    iv("be7", "Ana Kovac", ["backend"], 3, { 7: 1 }),
    iv("be8", "Viktor Petrov", ["backend"], 3, {}, [14]),
    iv("be9", "Rosa Alvarez", ["backend"], 3, { 3: 0.5, 10: 0.5 }),
    iv("be10", "Kiran Nair", ["backend"], 3, { 5: 1 }),
    iv("be11", "Felix Wagner", ["backend"], 3, { 8: 0.5 }),
    iv("be12", "Grace Kim", ["backend"], 3, {}, [12]),
    iv("be13", "Dan Brooks", ["backend"], 3, { 11: 0.5 }),
    // Backend + System Design
    iv("sd1", "Dev Sharma", ["backend", "sysdesign"], 3, { 2: 0.5, 8: 0.5 }, [11]),
    // The overlap set: System Design AND Staff+ (some also Backend).
    // December loads are year-end perf calibration + planning; PTO is the
    // normal Thanksgiving / early-December pattern.
    iv("ov1", "Priya Krishnan", ["backend", "sysdesign", "staffplus"], 3, { 1: 1, 3: 0.5, 5: 1, 7: 0.5, 10: 0.5, 11: 0.5, 12: 0.5, 13: 1, 14: 1 }, [15]),
    iv("ov2", "Rahul Mehta", ["sysdesign", "staffplus"], 3, { 2: 1, 4: 0.5, 8: 1, 11: 0.5, 12: 0.5, 14: 1 }, [13]),
    iv("ov3", "Maya Chen", ["backend", "sysdesign", "staffplus"], 3, { 0: 1, 6: 0.5, 10: 1, 11: 0.5, 13: 1, 14: 1 }, [12]),
    iv("ov4", "Arjun Singh", ["sysdesign", "staffplus"], 3, { 3: 1, 9: 0.5, 11: 0.5, 12: 0.5, 13: 1 }, [14]),
    iv("ov5", "Sana Iqbal", ["sysdesign", "staffplus"], 3, { 5: 0.5, 10: 0.5 }, [14]),
    // Staff+ only
    iv("st1", "Noah Berg", ["staffplus"], 2, {}, [12]),
  ];
}

// The sample plan is anchored to a fixed calendar (W0 = Mon Aug 31, 2026,
// deadline Tue Dec 15, 2026) so the demo tells the same story every time.
export function buildSampleModel(): PlanModel {
  const stages = defaultStages();
  stages[0].passRate = { value: 0.6, source: "provided" };
  stages[3].passRate = { value: 0.7, source: "provided" };

  return {
    planStartDate: "2026-08-31",
    horizonWeeks: 16,
    reqs: [
      {
        id: "Req 1 · Platform",
        role: "Backend Engineer",
        targetHires: 5,
        startWeek: 0,
        deadlineWeek: 15,
        deadlineDate: "2026-12-15",
        sourcingWeeks: 10,
      },
      {
        id: "Req 2 · Infra",
        role: "Backend Engineer",
        targetHires: 3,
        startWeek: 1,
        deadlineWeek: 15,
        deadlineDate: "2026-12-15",
        sourcingWeeks: 10,
      },
      {
        id: "Req 3 · Payments",
        role: "Backend Engineer",
        targetHires: 4,
        startWeek: 7,
        deadlineWeek: 15,
        deadlineDate: "2026-12-15",
        sourcingWeeks: 3,
      },
    ],
    stages,
    offerAccept: s(0.75, "assumed"),
    offerLagDays: s(10, "assumed"),
    bookingWasteRate: s(0.15, "assumed"),
    interviewers: sampleRoster(),
    rosterSource: "assumed",
    poolLabels: POOL_LABELS,
  };
}
