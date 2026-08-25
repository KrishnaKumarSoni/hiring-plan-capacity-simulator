// Core schema for the hiring-plan capacity model.
// Everything downstream of the parser is deterministic — no LLM output feeds these numbers.

export type Provenance = "provided" | "assumed" | "default";

export interface Sourced<T> {
  value: T;
  source: Provenance;
}

export interface Req {
  id: string;
  role: string;
  targetHires: number;
  startWeek: number; // 0-indexed week when sourcing/screens begin
  deadlineWeek: number; // 0-indexed week containing the deadline date
  deadlineDate: string; // ISO date
  // How many weeks recruiting spreads top-of-funnel candidates over.
  // Omitted = spread across every week that can still make the deadline.
  sourcingWeeks?: number;
}

export interface PanelSeat {
  pool: string;
  count: number;
}

export interface StageDef {
  id: string;
  name: string;
  durationMin: number;
  prepMin: number;
  feedbackMin: number;
  panel: PanelSeat[]; // interviewer seats consumed per candidate
  passRate: Sourced<number>; // conversion to the next stage
  lagDays: Sourced<number>; // days from completing this stage to sitting the next
}

export interface Interviewer {
  id: string;
  name: string;
  pools: string[];
  weeklyCapHours: number;
  existingLoadHours: Record<number, number>; // week index -> hours already committed
  ptoWeeks: number[]; // weeks fully out
}

export interface PlanModel {
  planStartDate: string; // ISO date of the Monday of week 0
  horizonWeeks: number;
  reqs: Req[];
  stages: StageDef[]; // ordered interview loop
  offerAccept: Sourced<number>;
  offerLagDays: Sourced<number>; // final stage -> signed accept
  bookingWasteRate: Sourced<number>; // failed/rescheduled slot rate
  interviewers: Interviewer[];
  rosterSource: Provenance; // whether roster was user-provided or generated
  poolLabels: Record<string, string>;
}

// ---------- Results ----------

export interface WeeklyDemand {
  // hours of interviewer time needed, by week then pool
  hoursByWeekPool: number[][]; // [week][poolIndex]
  poolIds: string[];
  // candidate volumes per stage per week (unconstrained plan)
  candidatesByWeekStage: number[][]; // [week][stageIndex]
  entrantsByWeek: number[];
}

export interface WeeklySupply {
  // residual hours by week then pool (naive per-pool view, double-counts people)
  apparentByWeekPool: number[][];
  // residual hours per interviewer per week
  residualByWeekInterviewer: number[][];
  poolIds: string[];
  totalByWeek: number[]; // unique human capacity per week
}

export interface PoolWeekCell {
  demandH: number;
  apparentCapH: number;
  ok: boolean;
}

export interface OverlapPerson {
  name: string;
  pools: string[];
  residualH: number;
}

export interface WeekDiagnosis {
  week: number;
  poolRows: { pool: string; demandH: number; apparentCapH: number; ok: boolean }[];
  unmetPools: string[];
  combinedDemandH: number;
  uniqueCapH: number;
  shortfallH: number;
  servedH: number;
  overlapPeople: OverlapPerson[];
}

export interface FeasibilityMatrix {
  poolIds: string[];
  cells: PoolWeekCell[][]; // [poolIndex][week]
  combinedOk: boolean[]; // per week, from max-flow
  diagnoses: WeekDiagnosis[]; // for failing weeks
}

export interface SimWeek {
  week: number;
  demandH: number; // new demand + backlog, by hours
  servedH: number;
  backlogH: number;
  capacityH: number;
  servedHByPool: Record<string, number>;
  utilization: number; // servedH / capacityH
  hiresLanded: number; // cumulative integer hires landed by end of this week
}

export interface SimResult {
  weeks: SimWeek[];
  hiresByDeadline: number;
  totalTarget: number;
  finalHireWeek: number | null; // null = never completes within horizon
  finalHireDate: string | null;
  slipDays: number; // 0 if on time; positive if late
  peakUtilization: number;
  deadlineDate: string;
  onTime: boolean;
}

export interface AnalysisSummary {
  totalTarget: number;
  role: string;
  deadlineDate: string;
  totalDemandH: number;
  totalCapacityH: number;
  totalCapacityOk: boolean; // period-total check (the naive one)
  allocationOk: boolean; // every week passes max-flow
  firstFailWeek: number | null;
}

export interface AnalysisResult {
  demand: WeeklyDemand;
  supply: WeeklySupply;
  matrix: FeasibilityMatrix;
  sim: SimResult;
  summary: AnalysisSummary;
}
