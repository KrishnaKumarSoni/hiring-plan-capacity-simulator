import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ExtractionSchema,
  buildModelFromExtraction,
  heuristicExtract,
} from "@/lib/extraction";

export const runtime = "nodejs";
export const maxDuration = 60;

// LLM = parser. One structured-output call turns the user's 2–3 lines into the
// extraction schema; the capacity model itself is deterministic and never sees
// LLM output beyond this typed extraction.
async function llmExtract(text: string, today: string) {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4000,
    system: [
      "You extract structured hiring-plan facts from a short free-text description.",
      `Today's date is ${today}.`,
      "Rules:",
      "- Extract ONLY what the text states. Use null for anything not stated — the caller applies labeled defaults; never invent rates, deadlines, or counts.",
      "- reqs: one entry per hiring req/batch mentioned; if the text gives one combined target, produce one req. startDelayWeeks is weeks from now until that req can begin sourcing (null or 0 if it starts immediately).",
      "- deadlineDate: resolve month/day mentions to the next future occurrence as YYYY-MM-DD.",
      "- funnelRates: map any stage-to-stage conversion percentages onto these stages: screen (recruiter screen), hm (hiring manager), coding, sysdesign (system design), behavioral. The rate on a stage is the probability of passing that stage. E.g. 'Screen to HM conversion is 60%' -> {stage:'screen', rate:0.6}; 'System Design to Behavioral is 70%' -> {stage:'sysdesign', rate:0.7}.",
      "- interviewerCount: total engineering interviewers mentioned, else null.",
      "- offerAcceptRate: only if the text states offer acceptance.",
    ].join("\n"),
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("parse-failed");
  }
  return response.parsed_output;
}

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (typeof text !== "string" || text.trim().length < 10) {
    return NextResponse.json({ error: "Describe the hiring plan in a few lines." }, { status: 400 });
  }
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const extraction = await llmExtract(text.slice(0, 4000), today);
      return NextResponse.json(buildModelFromExtraction(extraction, now, "llm"));
    } catch {
      // fall through to the heuristic parser
    }
  }
  const extraction = heuristicExtract(text);
  const result = buildModelFromExtraction(extraction, now, "heuristic");
  result.notes.unshift(
    "Read with the built-in quick parser. The AI parser handles messier phrasing when an API key is configured."
  );
  return NextResponse.json(result);
}
