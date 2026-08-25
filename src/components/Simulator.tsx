"use client";

import { useMemo, useState } from "react";
import {
  AnalysisResult,
  PlanModel,
  Provenance,
  SimResult,
  analyze,
  peakPoolSetLoad,
  weekToDate,
} from "@/engine";
import { buildScenarios, setHiringTarget, ScenarioDef } from "@/engine/scenarios";
import { runSensitivity } from "@/engine/sensitivity";
import { SAMPLE_TEXT, buildSampleModel } from "@/data/sample";

/* ---------- formatting ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso: string | null) => {
  if (!iso) return "beyond horizon";
  const d = new Date(iso + "T00:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
const fmtH = (h: number) => `${h % 1 === 0 ? h : h.toFixed(1)}h`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function Chip({ s }: { s: Provenance }) {
  return <span className={`chip ${s}`}>{s}</span>;
}

function finalHireLabel(sim: SimResult) {
  return sim.finalHireDate ? fmtDate(sim.finalHireDate) : "beyond horizon";
}
function slipLabel(sim: SimResult) {
  if (!sim.finalHireDate) return "does not complete";
  return sim.slipDays === 0 ? "on time" : `${sim.slipDays}d late`;
}

/* ---------- component ---------- */

type Phase = "input" | "parsing" | "ready";
type ParserKind = "llm" | "heuristic" | "sample";

export default function Simulator() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [phase, setPhase] = useState<Phase>("input");
  const [baseModel, setBaseModel] = useState<PlanModel | null>(null);
  const [parser, setParser] = useState<ParserKind>("sample");
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [targetOverride, setTargetOverride] = useState<number | null>(null);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [showInput, setShowInput] = useState(true);

  const analyzePlan = async (raw: string) => {
    setError(null);
    setScenarioId(null);
    setTargetOverride(null);
    setExpandedWeek(null);
    if (raw.trim() === SAMPLE_TEXT.trim()) {
      setBaseModel(buildSampleModel());
      setParser("sample");
      setNotes([
        "Sample plan: three reqs and a 20-person interviewer roster where the same senior people sit on several panels, with real week-to-week load and Nov-Dec PTO.",
        "Offer acceptance 75%, stage timing, prep and feedback time, and 15% booking waste are labeled assumptions. Edit any of them under Review assumptions.",
      ]);
      setPhase("ready");
      setShowInput(false);
      return;
    }
    setPhase("parsing");
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not parse the plan.");
      }
      const data = await res.json();
      setBaseModel(data.model);
      setParser(data.parser);
      setNotes(data.notes);
      setPhase("ready");
      setShowInput(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse the plan.");
      setPhase("input");
    }
  };

  const useSample = () => {
    setText(SAMPLE_TEXT);
    void analyzePlan(SAMPLE_TEXT);
  };

  /* ---------- derived analysis (all deterministic, in-browser) ---------- */

  const effBase = useMemo(() => {
    if (!baseModel) return null;
    return targetOverride == null ? baseModel : setHiringTarget(baseModel, targetOverride);
  }, [baseModel, targetOverride]);

  const base = useMemo(() => (effBase ? analyze(effBase) : null), [effBase]);

  const scenarios = useMemo(() => (effBase ? buildScenarios(effBase) : []), [effBase]);

  const scenarioResults = useMemo(() => {
    if (!effBase) return new Map<string, { model: PlanModel; result: AnalysisResult }>();
    const m = new Map<string, { model: PlanModel; result: AnalysisResult }>();
    for (const sc of scenarios) {
      const model = sc.apply(effBase);
      m.set(sc.id, { model, result: analyze(model) });
    }
    return m;
  }, [effBase, scenarios]);

  const sensitivity = useMemo(() => (effBase ? runSensitivity(effBase) : []), [effBase]);

  const bottleneckPools = useMemo(() => {
    if (!base || !effBase) return [] as string[];
    const set = new Set<string>();
    for (const d of base.matrix.diagnoses) d.unmetPools.forEach((p) => set.add(p));
    if (set.size === 0) ["sysdesign", "staffplus"].forEach((p) => {
      if (base.matrix.poolIds.includes(p)) set.add(p);
    });
    return [...set];
  }, [base, effBase]);

  const totalTarget = base?.sim.totalTarget ?? 0;
  const originalTarget = baseModel?.reqs.reduce((a, r) => a + r.targetHires, 0) ?? 0;

  const selectedScenario = scenarioId ? scenarioResults.get(scenarioId) : null;
  const selectedDef: ScenarioDef | undefined = scenarios.find((s) => s.id === scenarioId);

  const firstFail = base?.summary.firstFailWeek ?? null;
  const openWeek = expandedWeek ?? firstFail;
  const openDiag = base?.matrix.diagnoses.find((d) => d.week === openWeek) ?? null;

  const editModel = (fn: (m: PlanModel) => void) => {
    if (!baseModel) return;
    const m = clone(baseModel);
    fn(m);
    setBaseModel(m);
  };

  /* ---------- render ---------- */

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <b>candidate.fyi</b> · hiring plan capacity simulator
        </div>
        <div className="kicker">interviewer capacity, week by week</div>
      </div>

      {/* ============ INPUT ============ */}
      {showInput ? (
        <section style={{ maxWidth: 780 }}>
          <h1>Can your hiring plan fit your interviewer capacity?</h1>
          <p className="note" style={{ margin: "14px 0 22px", fontSize: 15 }}>
            Describe the hiring plan in a few lines: roles, targets, deadlines, and any known
            interviewer or funnel assumptions. We turn it into a working model, check interviewer
            capacity week by week, and show what breaks, when, and what fixes it.
          </p>
          <textarea
            className="plan-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Hire 12 backend engineers by Dec 15.\nWe have 20 interviewers across Backend, Staff+, and System Design.\nScreen → HM conversion is 60%; System Design → Behavioral is 70%.`}
          />
          <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn"
              disabled={phase === "parsing" || text.trim().length < 10}
              onClick={() => void analyzePlan(text)}
            >
              {phase === "parsing" ? "Parsing plan…" : "Analyze hiring plan"}
            </button>
            <button className="btn ghost" disabled={phase === "parsing"} onClick={useSample}>
              Use sample plan
            </button>
            {error && (
              <span className="note" style={{ color: "var(--fail)" }}>
                {error}
              </span>
            )}
          </div>
          <p className="mini-note" style={{ marginTop: 18 }}>
            AI reads your text once, only to structure it. Every number after that comes from an
            explicit model of interviewer availability, shared panels, and week-by-week carryover.
            AI never writes a forecast.
          </p>
        </section>
      ) : (
        <div
          className="card"
          style={{ padding: "12px 16px", display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
        >
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-soft)", whiteSpace: "pre-wrap", flex: "1 1 420px" }}>
            {text.trim()}
          </div>
          <button className="btn ghost small" onClick={() => setShowInput(true)}>
            Edit hiring plan
          </button>
        </div>
      )}

      {phase === "ready" && baseModel && effBase && base && (
        <ResultBody
          model={effBase}
          baseModelRaw={baseModel}
          base={base}
          parser={parser}
          notes={notes}
          scenarios={scenarios}
          scenarioResults={scenarioResults}
          scenarioId={scenarioId}
          setScenarioId={setScenarioId}
          selectedScenario={selectedScenario ?? null}
          selectedDef={selectedDef}
          sensitivity={sensitivity}
          bottleneckPools={bottleneckPools}
          totalTarget={totalTarget}
          originalTarget={originalTarget}
          targetOverride={targetOverride}
          setTargetOverride={setTargetOverride}
          openWeek={openWeek}
          setExpandedWeek={setExpandedWeek}
          openDiag={openDiag}
          editModel={editModel}
          onEditText={() => setShowInput(true)}
        />
      )}
    </div>
  );
}

/* =================================================================== */

function ResultBody(props: {
  model: PlanModel;
  baseModelRaw: PlanModel;
  base: AnalysisResult;
  parser: ParserKind;
  notes: string[];
  scenarios: ScenarioDef[];
  scenarioResults: Map<string, { model: PlanModel; result: AnalysisResult }>;
  scenarioId: string | null;
  setScenarioId: (id: string | null) => void;
  selectedScenario: { model: PlanModel; result: AnalysisResult } | null;
  selectedDef: ScenarioDef | undefined;
  sensitivity: ReturnType<typeof runSensitivity>;
  bottleneckPools: string[];
  totalTarget: number;
  originalTarget: number;
  targetOverride: number | null;
  setTargetOverride: (n: number | null) => void;
  openWeek: number | null;
  setExpandedWeek: (w: number | null) => void;
  openDiag: AnalysisResult["matrix"]["diagnoses"][number] | null;
  editModel: (fn: (m: PlanModel) => void) => void;
  onEditText: () => void;
}) {
  const {
    model, base, parser, notes, scenarios, scenarioResults, scenarioId, setScenarioId,
    selectedScenario, selectedDef, sensitivity, bottleneckPools, totalTarget, originalTarget,
    targetOverride, setTargetOverride, openWeek, setExpandedWeek, openDiag, editModel, onEditText,
  } = props;

  const sim = base.sim;
  const poolLabel = (p: string) => model.poolLabels[p] ?? p;
  const deadline = fmtDate(sim.deadlineDate);
  const late = sim.slipDays > 0 || sim.finalHireDate === null;
  const bottleneckLabel = bottleneckPools.map(poolLabel).join(" + ");

  const basePeak = peakPoolSetLoad(model, sim, bottleneckPools);
  const baseWorstDeficit = Math.max(0, ...base.matrix.diagnoses.map((d) => d.shortfallH));

  return (
    <>
      {/* ============ PLAN UNDERSTOOD ============ */}
      <section className="section fade-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 18 }}>Plan understood</h2>
          <span className="mini-note">
            {parser === "llm" ? "read by the AI parser" : parser === "heuristic" ? "read by the built-in parser" : "sample plan"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px 28px", marginTop: 14 }}>
          {model.reqs.map((r) => (
            <div key={r.id} className="card" style={{ padding: "10px 14px" }}>
              <div className="label">{r.id}</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>
                {r.targetHires} × {r.role}
              </div>
              <div className="num" style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
                sourcing from {fmtDate(weekToDate(model, r.startWeek))} · deadline {fmtDate(r.deadlineDate)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", marginTop: 14, fontSize: 13.5 }}>
          {model.stages.map((s) => (
            <span key={s.id}>
              {s.name} {pct(s.passRate.value)} <Chip s={s.passRate.source} />
            </span>
          ))}
          <span>
            Offer accept {pct(model.offerAccept.value)} <Chip s={model.offerAccept.source} />
          </span>
          <span>
            ~{model.stages[0].lagDays.value} days between stages <Chip s={model.stages[0].lagDays.source} />
          </span>
          <span>
            Roster · {model.interviewers.length} people <Chip s={model.rosterSource === "provided" ? "provided" : "assumed"} />
          </span>
        </div>
        {notes.length > 0 && (
          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            {notes.map((n, i) => (
              <li key={i} className="note" style={{ marginBottom: 2 }}>
                {n}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ============ VERDICT ============ */}
      <section className="section fade-in">
        <div className="verdict-grid">
          <div>
            <h2 style={{ marginBottom: 6 }}>
              {totalTarget} {model.reqs[0].role}
              {totalTarget === 1 ? "" : "s"} by {deadline}
            </h2>
            <p style={{ fontSize: 16, marginBottom: 18 }}>
              At current capacity, <b className="num">{sim.hiresByDeadline} of {totalTarget}</b> hires
              land by {deadline}.{" "}
              {sim.finalHireDate
                ? <>The final hire is projected for <b className="num">{fmtDate(sim.finalHireDate)}</b>.</>
                : <>The plan does not complete within the simulated horizon.</>}
            </p>
            <div className={`big-days ${late ? "late" : "ontime"}`}>
              {sim.finalHireDate === null
                ? "DOES NOT COMPLETE"
                : sim.slipDays === 0
                  ? "ON TIME"
                  : `${sim.slipDays} DAYS LATE`}
            </div>
            <p className={`hook ${late ? "" : "good"}`} style={{ marginTop: 22 }}>
              {late ? (
                <>
                  There are enough interviewer hours in total. The plan still cannot be executed:
                  the same senior people back both {bottleneckLabel} panels.
                </>
              ) : (
                <>Every week clears. The plan fits current interviewer capacity.</>
              )}
            </p>
          </div>
          <div className="card" style={{ padding: "6px 18px" }}>
            <div className="check-row">
              <span>Total interviewer capacity</span>
              <span className={`chip ${base.summary.totalCapacityOk ? "pass" : "fail"}`}>
                {base.summary.totalCapacityOk ? "pass" : "fail"}
              </span>
            </div>
            <div className="check-row">
              <span>Every week staffable</span>
              <span className={`chip ${base.summary.allocationOk ? "pass" : "fail"}`}>
                {base.summary.allocationOk ? "pass" : "fail"}
              </span>
            </div>
            <div className="check-row">
              <span className="note">Interviewer hours required</span>
              <span className="num">{Math.round(base.summary.totalDemandH)}h</span>
            </div>
            <div className="check-row">
              <span className="note">Interviewer hours available</span>
              <span className="num">{Math.round(base.summary.totalCapacityH)}h</span>
            </div>
            <div className="check-row">
              <span className="note">First week that breaks</span>
              <span className="num">
                {base.summary.firstFailWeek === null ? "none" : `W${base.summary.firstFailWeek + 1} · ${fmtDate(weekToDate(model, base.summary.firstFailWeek))}`}
              </span>
            </div>
            <div className="check-row">
              <span className="note">Peak {bottleneckLabel} load</span>
              <span className="num">{pct(basePeak)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ============ MATRIX ============ */}
      <section className="section fade-in">
        <h2 style={{ fontSize: 18 }}>Week-by-week capacity</h2>
        <p className="note" style={{ margin: "8px 0 16px" }}>
          Each pool row checks that pool on its own. The combined row checks whether every
          interview can actually be staffed when each person is counted only once. That is where
          shared panels surface.
        </p>
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th className="rowhead" />
                {base.matrix.combinedOk.map((_, w) => (
                  <th key={w}>
                    W{w + 1}
                    <br />
                    <span style={{ fontSize: 9, color: "var(--ink-faint)" }}>{fmtDate(weekToDate(model, w))}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {base.matrix.poolIds.map((p, pi) => (
                <tr key={p}>
                  <td className="rowhead">{poolLabel(p)}</td>
                  {base.matrix.cells[pi].map((c, w) => (
                    <td key={w} className={c.ok ? "cell-ok" : "cell-fail"} title={`${poolLabel(p)} W${w + 1}: demand ${fmtH(c.demandH)} vs ${fmtH(c.apparentCapH)}`}>
                      {c.ok ? "✓" : "✕"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="combined">
                <td className="rowhead">All panels combined</td>
                {base.matrix.combinedOk.map((ok, w) => (
                  <td
                    key={w}
                    className={ok ? "cell-ok" : `cell-fail${openWeek === w ? " active" : ""}`}
                    onClick={() => !ok && setExpandedWeek(w)}
                  >
                    {ok ? "✓" : "FAIL"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* ---- expanded diagnosis ---- */}
        {openDiag && (
          <div className="diag fade-in" style={{ marginTop: 20 }}>
            <div className="diag-head">
              <h3 style={{ color: "#fff" }}>
                Week {openDiag.week + 1} fails · {fmtDate(weekToDate(model, openDiag.week))}
              </h3>
              <span className="num" style={{ fontSize: 13 }}>
                shortfall {fmtH(openDiag.shortfallH)}
              </span>
            </div>
            <div className="diag-body">
              <div className="diag-pools">
                {openDiag.poolRows
                  .filter((r) => openDiag.unmetPools.includes(r.pool))
                  .map((r) => (
                    <div key={r.pool} className="diag-pool">
                      <div className="label">{poolLabel(r.pool)}</div>
                      <div className="num" style={{ marginTop: 4, fontSize: 14 }}>
                        needs <b>{fmtH(r.demandH)}</b>
                      </div>
                      <div className="num" style={{ fontSize: 14 }}>
                        has on paper <b>{fmtH(r.apparentCapH)}</b>{" "}
                        <span className={`chip ${r.ok ? "pass" : "fail"}`}>{r.ok ? "✓ looks fine" : "short"}</span>
                      </div>
                    </div>
                  ))}
              </div>

              {openDiag.overlapPeople.length > 0 && (
                <>
                  <p style={{ margin: "16px 0 10px", fontSize: 15 }}>
                    But{" "}
                    <b>
                      {openDiag.overlapPeople.map((p) => p.name.split(" ")[0]).join(", ").replace(/, ([^,]*)$/, " and $1")}
                    </b>{" "}
                    belong to {openDiag.unmetPools.length > 1 ? "both pools" : "this pool"}. The same people are being counted twice.
                  </p>
                  <div className="overlap-people">
                    {openDiag.overlapPeople.map((p) => (
                      <div key={p.name} className="person">
                        <b>{p.name}</b>
                        <span>
                          {p.pools.map(poolLabel).join(" + ")} · {fmtH(p.residualH)} free
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: 28, flexWrap: "wrap", margin: "18px 0 8px" }} className="num">
                <span>
                  Both pools need <b style={{ fontSize: 17 }}>{fmtH(openDiag.combinedDemandH)}</b>
                </span>
                <span>
                  Those people have <b style={{ fontSize: 17 }}>{fmtH(openDiag.uniqueCapH)}</b>
                </span>
                <span style={{ color: "var(--fail)" }}>
                  Shortfall <b style={{ fontSize: 17 }}>{fmtH(openDiag.shortfallH)}</b>
                </span>
              </div>
              <p className="hook" style={{ marginTop: 12 }}>
                Every pool looks healthy on its own. Shared interviewers make the week impossible,
                and the interviews that can&apos;t be staffed roll into the next week.
              </p>
              <p className="mini-note" style={{ marginTop: 12 }}>
                This checks whether enough eligible interviewer hours exist each week, not whether
                specific calendar slots line up. Interviews that can&apos;t be staffed carry into the
                following week, which is what moves the completion date.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ============ SENSITIVITY ============ */}
      <section className="section fade-in">
        <h2 style={{ fontSize: 18 }}>How fragile is this forecast?</h2>
        <p className="note" style={{ marginTop: 6 }}>
          The forecast moves with its inputs. Two of them, stress-tested:
        </p>
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {sensitivity.map((line) => (
            <div key={line.label} className="card" style={{ padding: "12px 16px" }}>
              <span style={{ fontSize: 14.5 }}>
                If <b>{line.label.toLowerCase()}</b> drops from{" "}
                <b className="num">{pct(line.baseRate)}</b> to <b className="num">{pct(line.altRate)}</b>:
                projected slip{" "}
                <b className="num">
                  {line.baseSlipDays >= 999 ? "∞" : `${line.baseSlipDays}d`} →{" "}
                  {line.altSlipDays >= 999 ? "∞" : `${line.altSlipDays}d`}
                </b>{" "}
                <span className="note">
                  (final hire {fmtDate(line.baseFinalHireDate)} → {fmtDate(line.altFinalHireDate)})
                </span>
              </span>
              {line.note && (
                <div className="mini-note" style={{ marginTop: 6 }}>
                  {line.note}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ============ SCENARIOS ============ */}
      <section className="section fade-in">
        <h2 style={{ fontSize: 18 }}>What changes the outcome?</h2>
        <div className="scen-grid" style={{ marginTop: 14 }}>
          {scenarios.map((sc) => {
            const r = scenarioResults.get(sc.id)!;
            const s = r.result.sim;
            return (
              <button
                key={sc.id}
                className={`scen${scenarioId === sc.id ? " selected" : ""}`}
                onClick={() => setScenarioId(scenarioId === sc.id ? null : sc.id)}
              >
                <h3>{sc.name}</h3>
                <div className="num" style={{ margin: "8px 0 2px", fontSize: 15 }}>
                  Projected finish: <b>{finalHireLabel(s)}</b>{" "}
                  <span className={`chip ${s.slipDays === 0 ? "pass" : "fail"}`}>{slipLabel(s)}</span>
                </div>
                <div className="note" style={{ marginTop: 6 }}>{sc.detail}</div>
                <div className="mini-note" style={{ marginTop: 6 }}>{sc.tradeoff}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 22, flexWrap: "wrap" }}>
          <span className="label">Hiring target</span>
          <div className="stepper">
            <button
              onClick={() => setTargetOverride(Math.max(1, totalTarget - 1))}
              disabled={totalTarget <= 1}
              aria-label="decrease target"
            >
              −
            </button>
            <span className="val">{totalTarget}</span>
            <button
              onClick={() => setTargetOverride(totalTarget + 1)}
              disabled={totalTarget >= originalTarget + 12}
              aria-label="increase target"
            >
              +
            </button>
          </div>
          {targetOverride != null && targetOverride !== originalTarget && (
            <button className="btn ghost small" onClick={() => setTargetOverride(null)}>
              Reset to {originalTarget}
            </button>
          )}
          <span className="note">
            Changing the target reruns the whole model. Scenarios apply on top.
          </span>
        </div>

        {/* ---- comparison ---- */}
        {selectedScenario && selectedDef && (
          <div className="compare-grid fade-in" style={{ marginTop: 22 }}>
            <CompareCol
              title="Current plan"
              result={base}
              model={model}
              pools={bottleneckPools}
              deadline={sim.deadlineDate}
              winner={false}
            />
            <CompareCol
              title={selectedDef.name}
              result={selectedScenario.result}
              model={selectedScenario.model}
              pools={bottleneckPools}
              deadline={sim.deadlineDate}
              winner={
                selectedScenario.result.sim.slipDays < sim.slipDays ||
                selectedScenario.result.sim.hiresByDeadline > sim.hiresByDeadline
              }
            />
          </div>
        )}
      </section>

      {/* ============ ASSUMPTIONS ============ */}
      <AssumptionsEditor model={props.baseModelRaw} editModel={editModel} onEditText={onEditText} originalText={null} />

      <footer style={{ marginTop: 60, borderTop: "1px solid var(--rule-strong)", paddingTop: 18 }}>
        <p className="mini-note">
          How it works: AI reads your text once and turns it into structured inputs. Every forecast
          comes from an explicit model: funnel math, each interviewer&apos;s weekly availability, an
          allocation check that counts each person only once across panels, and interviews that
          carry over week to week. It checks whether the hours exist, not whether calendar slots
          line up. AI never invents a number.
        </p>
      </footer>
    </>
  );
}

/* =================================================================== */

function CompareCol(props: {
  title: string;
  result: AnalysisResult;
  model: PlanModel;
  pools: string[];
  deadline: string;
  winner: boolean;
}) {
  const { title, result, model, pools, winner } = props;
  const s = result.sim;
  const worstDeficit = Math.max(0, ...result.matrix.diagnoses.map((d) => d.shortfallH));
  const peak = peakPoolSetLoad(model, s, pools);
  const failWeeks = result.matrix.combinedOk.filter((ok) => !ok).length;
  return (
    <div className={`compare-col${winner ? " winner" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3>{title}</h3>
        {winner && <span className="chip pass">better</span>}
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="stat-row">
          <span className="note">Hires by {fmtDate(s.deadlineDate)}</span>
          <span className="num" style={{ fontWeight: 700 }}>
            {s.hiresByDeadline} / {s.totalTarget}
          </span>
        </div>
        <div className="stat-row">
          <span className="note">Final hire</span>
          <span className="num" style={{ fontWeight: 700 }}>
            {finalHireLabel(s)} <span className={`chip ${s.slipDays === 0 ? "pass" : "fail"}`}>{slipLabel(s)}</span>
          </span>
        </div>
        <div className="stat-row">
          <span className="note">Peak load on {pools.map((p) => model.poolLabels[p] ?? p).join(" + ")}</span>
          <span className="num">{pct(peak)}</span>
        </div>
        <div className="stat-row">
          <span className="note">Worst week short by</span>
          <span className="num">{fmtH(worstDeficit)}</span>
        </div>
        <div className="stat-row">
          <span className="note">Weeks that break</span>
          <span className="num">{failWeeks}</span>
        </div>
      </div>
    </div>
  );
}

/* =================================================================== */

function AssumptionsEditor(props: {
  model: PlanModel;
  editModel: (fn: (m: PlanModel) => void) => void;
  onEditText: () => void;
  originalText: string | null;
}) {
  const { model, editModel, onEditText } = props;
  const poolIds = Object.keys(model.poolLabels);
  const shortPool = (p: string) => {
    const l = model.poolLabels[p] ?? p;
    if (l === "Hiring Manager") return "HM";
    if (l === "System Design") return "Sys Design";
    return l;
  };

  return (
    <section className="section">
      <details className="assume">
        <summary>
          <span className="indicator" style={{ fontSize: 18 }} />
          <h2 style={{ fontSize: 18 }}>Review assumptions</h2>
          <span className="note">see and edit what the model uses; everything recomputes</span>
        </summary>

        <div style={{ marginTop: 20, display: "grid", gap: 30 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h3>Hiring plan</h3>
              <button className="btn ghost small" onClick={onEditText}>
                Edit original text
              </button>
            </div>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Req</th>
                  <th>Role</th>
                  <th>Target</th>
                  <th>Sourcing starts</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {model.reqs.map((r, i) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.role}</td>
                    <td>
                      <span className="field">
                        <input
                          type="number"
                          min={0}
                          value={r.targetHires}
                          onChange={(e) =>
                            editModel((m) => {
                              m.reqs[i].targetHires = Math.max(0, parseInt(e.target.value || "0", 10));
                            })
                          }
                        />
                        <span className="suffix">hires</span>
                      </span>
                    </td>
                    <td>
                      <span className="field">
                        <span className="suffix">week</span>
                        <input
                          type="number"
                          min={1}
                          max={r.deadlineWeek}
                          value={r.startWeek + 1}
                          onChange={(e) =>
                            editModel((m) => {
                              const v = parseInt(e.target.value || "1", 10) - 1;
                              m.reqs[i].startWeek = Math.max(0, Math.min(v, m.reqs[i].deadlineWeek - 1));
                            })
                          }
                        />
                      </span>
                    </td>
                    <td className="num">{r.deadlineDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div>
            <h3>Funnel and offer</h3>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Pass rate</th>
                    <th>Source</th>
                    <th>Days to next</th>
                    <th>Length</th>
                    <th>Prep + notes</th>
                    <th>Panel</th>
                  </tr>
                </thead>
                <tbody>
                  {model.stages.map((s, i) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>
                        <span className="field">
                          <input
                            type="number"
                            min={5}
                            max={100}
                            value={Math.round(s.passRate.value * 100)}
                            onChange={(e) =>
                              editModel((m) => {
                                m.stages[i].passRate = {
                                  value: Math.min(1, Math.max(0.05, parseInt(e.target.value || "50", 10) / 100)),
                                  source: "provided",
                                };
                              })
                            }
                          />
                          <span className="suffix">%</span>
                        </span>
                      </td>
                      <td>
                        <Chip s={s.passRate.source} />
                      </td>
                      <td>
                        <span className="field">
                          <input
                            type="number"
                            min={0}
                            max={30}
                            value={s.lagDays.value}
                            onChange={(e) =>
                              editModel((m) => {
                                m.stages[i].lagDays = {
                                  value: Math.max(0, parseInt(e.target.value || "0", 10)),
                                  source: "provided",
                                };
                              })
                            }
                          />
                          <span className="suffix">days</span>
                        </span>
                      </td>
                      <td className="num">{s.durationMin}m</td>
                      <td className="num">
                        {s.prepMin}m + {s.feedbackMin}m
                      </td>
                      <td className="num">
                        {s.panel.map((seat) => `${seat.count} × ${shortPool(seat.pool)}`).join(", ")}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>Offer accepted</td>
                    <td>
                      <span className="field">
                        <input
                          type="number"
                          min={5}
                          max={100}
                          value={Math.round(model.offerAccept.value * 100)}
                          onChange={(e) =>
                            editModel((m) => {
                              m.offerAccept = {
                                value: Math.min(1, Math.max(0.05, parseInt(e.target.value || "75", 10) / 100)),
                                source: "provided",
                              };
                            })
                          }
                        />
                        <span className="suffix">%</span>
                      </span>
                    </td>
                    <td>
                      <Chip s={model.offerAccept.source} />
                    </td>
                    <td className="num">{model.offerLagDays.value} days</td>
                    <td colSpan={3}>
                      <span className="field">
                        <span className="suffix">Booking waste</span>
                        <input
                          type="number"
                          min={0}
                          max={50}
                          value={Math.round(model.bookingWasteRate.value * 100)}
                          onChange={(e) =>
                            editModel((m) => {
                              m.bookingWasteRate = {
                                value: Math.min(0.5, Math.max(0, parseInt(e.target.value || "0", 10) / 100)),
                                source: "provided",
                              };
                            })
                          }
                        />
                        <span className="suffix">%</span>
                      </span>{" "}
                      <Chip s={model.bookingWasteRate.source} />{" "}
                      <span className="mini-note">covers reschedules and no-shows</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3>
              Interviewer roster{" "}
              {model.rosterSource !== "provided" && <span className="chip assumed">generated assumption</span>}
            </h3>
            <p className="mini-note" style={{ margin: "6px 0 10px" }}>
              Available time each week is a person&apos;s cap minus their existing load, and zero on
              PTO weeks. Toggle panels or adjust caps and everything recomputes.
            </p>
            <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid var(--rule)" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Panels</th>
                    <th>Cap per week</th>
                    <th>Existing load</th>
                    <th>PTO</th>
                  </tr>
                </thead>
                <tbody>
                  {model.interviewers.map((iv, i) => (
                    <tr key={iv.id}>
                      <td style={{ fontWeight: 600 }}>{iv.name}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          {poolIds.map((p) => (
                            <button
                              key={p}
                              className={`pool-toggle${iv.pools.includes(p) ? " on" : ""}`}
                              onClick={() =>
                                editModel((m) => {
                                  const pools = m.interviewers[i].pools;
                                  const idx = pools.indexOf(p);
                                  if (idx >= 0) pools.splice(idx, 1);
                                  else pools.push(p);
                                })
                              }
                            >
                              {shortPool(p)}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className="field">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            step={0.5}
                            value={iv.weeklyCapHours}
                            onChange={(e) =>
                              editModel((m) => {
                                m.interviewers[i].weeklyCapHours = Math.max(0, parseFloat(e.target.value || "0"));
                              })
                            }
                          />
                          <span className="suffix">h</span>
                        </span>
                      </td>
                      <td className="num" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                        {Object.entries(iv.existingLoadHours)
                          .map(([w, h]) => `W${+w + 1}:${h}h`)
                          .join(" ") || "none"}
                      </td>
                      <td className="num" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                        {iv.ptoWeeks.map((w) => `W${w + 1}`).join(" ") || "none"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
