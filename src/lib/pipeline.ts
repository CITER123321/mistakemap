import { clusterOffline, gradeOffline, planOffline } from "./heuristic";
import type { LLM } from "./llm";
import { parseAnswers } from "./parse";
import { pseudonymise } from "./privacy";
import { clusterPrompt, gradePrompt, planPrompt, SYSTEM_BASE } from "./prompts";
import { SAMPLES, type Sample } from "./samples";
import {
  ClusterResultSchema,
  GradeResultSchema,
  PlanResultSchema,
  type Answer,
  type Grade,
  type Misconception,
  type ReteachPlan,
  type StepMeta,
  type Task,
} from "./types";
import { verifyClusters, verifyPlans } from "./verify";

const sampleAnswers = new Map<string, Answer[]>(SAMPLES.map((s) => [s.id, pseudonymise(parseAnswers(s.raw)).answers]));

/** Returns the bundled sample if the request is exactly that sample (same question, same answers). */
export function matchSample(task: Task, answers: Answer[]): Sample | undefined {
  return SAMPLES.find((s) => {
    const sa = sampleAnswers.get(s.id)!;
    return (
      s.task.question.trim() === task.question.trim() &&
      sa.length === answers.length &&
      sa.every((a, i) => a.id === answers[i].id && a.text === answers[i].text)
    );
  });
}

function meta(llm: LLM | null, sample: Sample | undefined, notes: string[] = []): StepMeta {
  if (llm) return { mode: "live", provider: llm.provider, model: llm.model, notes };
  if (sample) return { mode: "demo-fixture", provider: "none", model: "bundled sample analysis", notes };
  return { mode: "offline-heuristic", provider: "none", model: "offline heuristic (no AI)", notes };
}

/** Makes sure there is exactly one grade per answer, whatever the model returned. */
export function completeGrades(answers: Answer[], grades: Grade[]): { grades: Grade[]; notes: string[] } {
  const byId = new Map<string, Grade>();
  let invented = 0;
  for (const g of grades) {
    if (!answers.some((a) => a.id === g.id)) invented++;
    else if (!byId.has(g.id)) byId.set(g.id, { ...g, confidence: Math.max(0, Math.min(1, g.confidence)) });
  }
  const notes: string[] = [];
  const missing = answers.filter((a) => !byId.has(a.id));
  if (missing.length) notes.push(`The model skipped ${missing.length} answer(s); marked them "unclear" for you to check.`);
  if (invented) notes.push(`Ignored ${invented} grade(s) for students that do not exist.`);
  return {
    grades: answers.map((a) => byId.get(a.id) ?? { id: a.id, verdict: "unclear", confidence: 0, reason: "Not checked by the model." }),
    notes,
  };
}

export async function stepGrade(task: Task, answers: Answer[], llm: LLM | null) {
  const sample = llm ? undefined : matchSample(task, answers);
  if (llm) {
    const raw = await llm.json({ system: SYSTEM_BASE, prompt: gradePrompt(task, answers), schema: GradeResultSchema });
    const { grades, notes } = completeGrades(answers, raw.grades);
    return { grades, meta: meta(llm, undefined, notes) };
  }
  if (sample) {
    const grades: Grade[] = answers.map((a, i) => {
      const [verdict, confidence, reason] = sample.fixture.grades[i];
      return { id: a.id, verdict, confidence, reason };
    });
    return { grades, meta: meta(null, sample) };
  }
  return { grades: gradeOffline(task, answers), meta: meta(null, undefined, ["No API key: compared answers with the key using simple rules."]) };
}

export async function stepCluster(task: Task, answers: Answer[], grades: Grade[], llm: LLM | null) {
  const sample = llm ? undefined : matchSample(task, answers);
  let raw;
  if (llm) {
    const hasWrong = grades.some((g) => g.verdict !== "correct");
    raw = hasWrong
      ? await llm.json({ system: SYSTEM_BASE, prompt: clusterPrompt(task, answers, grades), schema: ClusterResultSchema })
      : { misconceptions: [], unassigned: [] };
  } else if (sample) raw = sample.fixture.clusters;
  else raw = clusterOffline(task, answers, grades);
  const { misconceptions, notes } = verifyClusters(raw, answers, grades);
  return { misconceptions, meta: meta(llm, sample, notes) };
}

export async function stepPlan(task: Task, answers: Answer[], misconceptions: Misconception[], llm: LLM | null) {
  const sample = llm ? undefined : matchSample(task, answers);
  const targets = misconceptions.filter((m) => m.id !== "REVIEW");
  let plans: ReteachPlan[];
  if (!targets.length) plans = [];
  else if (llm) plans = (await llm.json({ system: SYSTEM_BASE, prompt: planPrompt(task, targets), schema: PlanResultSchema })).plans;
  else if (sample) plans = sample.fixture.plans;
  else plans = planOffline(task, targets, answers);
  const v = verifyPlans(plans, targets);
  const notes = [...v.notes];
  if (!llm && !sample) notes.push("No API key: these are generic templates, not tailored plans.");
  return { plans: v.plans, meta: meta(llm, sample, notes) };
}
