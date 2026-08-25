import { PlanModel, Sourced, StageDef, Interviewer, Provenance } from "@/engine/types";

export const POOL_LABELS: Record<string, string> = {
  recruiter: "Recruiter",
  hm: "Hiring Manager",
  backend: "Backend",
  sysdesign: "System Design",
  staffplus: "Staff+",
};

export const s = <T>(value: T, source: Provenance = "default"): Sourced<T> => ({ value, source });

// Default interview loop for an engineering role. Every value here is a
// visible, editable demo assumption — not a universal truth.
export function defaultStages(): StageDef[] {
  return [
    {
      id: "screen",
      name: "Recruiter Screen",
      durationMin: 30,
      prepMin: 5,
      feedbackMin: 10,
      panel: [{ pool: "recruiter", count: 1 }],
      passRate: s(0.6),
      lagDays: s(7),
    },
    {
      id: "hm",
      name: "Hiring Manager",
      durationMin: 45,
      prepMin: 10,
      feedbackMin: 15,
      panel: [{ pool: "hm", count: 1 }],
      passRate: s(0.65),
      lagDays: s(7),
    },
    {
      id: "coding",
      name: "Coding",
      durationMin: 60,
      prepMin: 10,
      feedbackMin: 15,
      panel: [{ pool: "backend", count: 2 }],
      passRate: s(0.55),
      lagDays: s(7),
    },
    {
      id: "sysdesign",
      name: "System Design",
      durationMin: 90,
      prepMin: 15,
      feedbackMin: 15,
      panel: [{ pool: "sysdesign", count: 1 }],
      passRate: s(0.7),
      lagDays: s(7),
    },
    {
      id: "behavioral",
      name: "Behavioral",
      durationMin: 45,
      prepMin: 10,
      feedbackMin: 15,
      panel: [{ pool: "staffplus", count: 2 }],
      passRate: s(0.8),
      lagDays: s(3),
    },
  ];
}

export function nextMonday(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const day = d.getUTCDay();
  const add = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export function weekOf(planStart: string, dateIso: string): number {
  const a = new Date(planStart + "T00:00:00Z").getTime();
  const b = new Date(dateIso + "T00:00:00Z").getTime();
  return Math.floor((b - a) / (7 * 86400000));
}

// Deterministic synthetic roster for user-entered plans that only give a
// headcount. Labeled "generated assumption" in the UI. A simple seeded PRNG
// keeps it stable across runs.
export function generateRoster(engineerCount: number, horizonWeeks: number): Interviewer[] {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const first = [
    "Sofia", "Lucas", "Maya", "Emma", "Yuki", "Daniel", "Noah", "Lucia", "Chen", "Omar",
    "Anna", "Jake", "Ana", "Viktor", "Rosa", "Mia", "Felix", "Grace", "Dan", "Sam",
    "Ines", "Marco", "Petra", "Nora", "Leo", "Elsa", "Hugo", "Iris", "Owen", "Tara",
  ];
  const roster: Interviewer[] = [];
  const n = Math.max(6, Math.min(30, engineerCount));
  // ~30% of senior interviewers end up in multiple pools — that overlap is
  // exactly what the max-flow check exists to catch.
  for (let i = 0; i < n; i++) {
    const name = first[i % first.length] + (i >= first.length ? ` ${Math.floor(i / first.length) + 1}` : "");
    const r = rand();
    let pools: string[];
    if (r < 0.15) pools = ["sysdesign", "staffplus"];
    else if (r < 0.3) pools = ["backend", "sysdesign", "staffplus"];
    else if (r < 0.4) pools = ["backend", "sysdesign"];
    else if (r < 0.5) pools = ["staffplus"];
    else pools = ["backend"];
    const cap = pools.includes("staffplus") ? (rand() < 0.3 ? 2 : 3) : 3;
    const existingLoadHours: Record<number, number> = {};
    for (let w = 0; w < horizonWeeks; w++) {
      if (rand() < 0.3) existingLoadHours[w] = Math.round(rand() * 3) / 2; // 0–1.5h
    }
    const ptoWeeks: number[] = [];
    if (rand() < 0.5) ptoWeeks.push(Math.floor(rand() * horizonWeeks));
    roster.push({ id: `iv${i}`, name, pools, weeklyCapHours: cap, existingLoadHours, ptoWeeks });
  }
  // recruiters + hiring managers to run the top of the funnel
  for (let i = 0; i < 3; i++) {
    roster.push({
      id: `rec${i}`,
      name: ["Nora Whitfield", "Tomas Rivera", "Elena Rodrigues"][i],
      pools: ["recruiter"],
      weeklyCapHours: 8,
      existingLoadHours: {},
      ptoWeeks: i === 0 ? [Math.floor(horizonWeeks * 0.75)] : [],
    });
  }
  for (let i = 0; i < 3; i++) {
    roster.push({
      id: `hm${i}`,
      name: ["Marcus Webb", "Claire Fontaine", "James Liu"][i],
      pools: ["hm"],
      weeklyCapHours: 7,
      existingLoadHours: { [2 + i * 3]: 1 },
      ptoWeeks: [],
    });
  }
  return roster;
}
