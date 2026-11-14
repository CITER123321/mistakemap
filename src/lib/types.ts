import { z } from "zod";

/** What the teacher asked. Never contains student data. */
export const TaskSchema = z.object({
  question: z.string().min(3).max(1500),
  answerKey: z.string().max(1500).default(""),
  context: z.string().max(300).default(""), // e.g. "Year 7 maths, fractions unit"
});
export type Task = z.infer<typeof TaskSchema>;

/** One answer after local pseudonymisation. `id` is like "S07"; the real name stays in the browser. */
export const AnswerSchema = z.object({
  id: z.string().regex(/^S\d{2,3}$/),
  text: z.string().max(1200),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const VERDICTS = ["correct", "partial", "incorrect", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const GradeSchema = z.object({
  id: z.string(),
  verdict: z.enum(VERDICTS),
  confidence: z.number(),
  reason: z.string(),
});
export type Grade = z.infer<typeof GradeSchema>;

export const GradeResultSchema = z.object({ grades: z.array(GradeSchema) });

export const EvidenceSchema = z.object({
  studentId: z.string(),
  quote: z.string(),
});

export const SEVERITIES = ["minor", "moderate", "fundamental"] as const;

/** Raw cluster as the model returns it (before verification). */
export const RawMisconceptionSchema = z.object({
  title: z.string(),
  belief: z.string(), // what the student seems to believe, in plain words
  whyItHappens: z.string(),
  severity: z.enum(SEVERITIES),
  studentIds: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
});
export type RawMisconception = z.infer<typeof RawMisconceptionSchema>;

export const ClusterResultSchema = z.object({
  misconceptions: z.array(RawMisconceptionSchema),
  unassigned: z.array(z.string()),
});
export type ClusterResult = z.infer<typeof ClusterResultSchema>;

export const CheckQuestionSchema = z.object({
  question: z.string(),
  answer: z.string(),
  revealsIf: z.string(), // which wrong answer would show the misconception is still there
});

export const ReteachPlanSchema = z.object({
  misconceptionId: z.string(),
  steps: z.array(z.object({ minutes: z.number(), action: z.string() })),
  contrastExample: z.string(),
  checkQuestions: z.array(CheckQuestionSchema),
  studentNote: z.string(),
});
export type ReteachPlan = z.infer<typeof ReteachPlanSchema>;

export const PlanResultSchema = z.object({ plans: z.array(ReteachPlanSchema) });

/** Verified cluster used by the UI. */
export interface Misconception extends RawMisconception {
  id: string; // "M1", "M2", ... or "REVIEW"
  evidence: Array<{ studentId: string; quote: string; verified: boolean }>;
  warnings: string[];
}

export type Mode = "live" | "demo-fixture" | "offline-heuristic";

export interface StepMeta {
  mode: Mode;
  provider: string; // "anthropic", "gemini", "none"
  model: string;
  notes: string[];
}

export interface Analysis {
  grades: Grade[];
  misconceptions: Misconception[];
  plans: ReteachPlan[];
  flags: Array<{ studentId: string; kind: "prompt-injection"; detail: string }>;
  meta: StepMeta[];
}
