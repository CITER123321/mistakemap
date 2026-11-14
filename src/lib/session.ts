/** Pure helpers for the teacher's edits and exports. Run in the browser; no AI involved. */
import { reidentify } from "./privacy";
import type { Analysis, Answer, Misconception, Task, Verdict } from "./types";
import { REVIEW_ID } from "./verify";

export interface Session {
  task: Task;
  raw: string;
  answers: Answer[];
  roster: Record<string, string>;
  redactions: number;
  analysis: Analysis;
  sampleId?: string;
  createdAt: string;
}

function reviewGroup(): Misconception {
  return {
    id: REVIEW_ID,
    title: "Needs a closer look",
    belief: "These answers did not fit a shared pattern with enough confidence.",
    whyItHappens: "Could be unclear handwriting, an unusual method, a blank answer, or a one-off slip.",
    severity: "moderate",
    studentIds: [],
    evidence: [],
    warnings: [],
  };
}

function tidy(ms: Misconception[]): Misconception[] {
  return ms.filter((m) => m.studentIds.length > 0 || m.id !== REVIEW_ID);
}

/** Teacher overrides a verdict. Keeps groups consistent: correct answers leave groups, new mistakes go to review. */
export function setVerdict(a: Analysis, studentId: string, verdict: Verdict): Analysis {
  const grades = a.grades.map((g) => (g.id === studentId ? { ...g, verdict, confidence: 1, reason: `Set by teacher (was: ${g.verdict}).` } : g));
  let ms = a.misconceptions.map((m) => ({ ...m, studentIds: m.studentIds.filter((id) => id !== studentId) }));
  if (verdict !== "correct") {
    if (!ms.some((m) => m.id === REVIEW_ID)) ms = [...ms, reviewGroup()];
    ms = ms.map((m) => (m.id === REVIEW_ID ? { ...m, studentIds: [...m.studentIds, studentId].sort() } : m));
  }
  return { ...a, grades, misconceptions: tidy(ms) };
}

export function moveStudent(a: Analysis, studentId: string, toId: string): Analysis {
  let ms = a.misconceptions.map((m) => ({
    ...m,
    studentIds: m.studentIds.filter((id) => id !== studentId),
    evidence: m.evidence.filter((e) => e.studentId !== studentId || m.id === toId),
  }));
  if (toId === REVIEW_ID && !ms.some((m) => m.id === REVIEW_ID)) ms = [...ms, reviewGroup()];
  ms = ms.map((m) => (m.id === toId ? { ...m, studentIds: [...m.studentIds, studentId] } : m));
  return { ...a, misconceptions: tidy(ms) };
}

export function renameGroup(a: Analysis, id: string, title: string): Analysis {
  return { ...a, misconceptions: a.misconceptions.map((m) => (m.id === id ? { ...m, title: title.trim() || m.title } : m)) };
}

export function summarise(a: Analysis) {
  const count = (v: Verdict) => a.grades.filter((g) => g.verdict === v).length;
  const groups = a.misconceptions.filter((m) => m.id !== REVIEW_ID);
  return {
    total: a.grades.length,
    correct: count("correct"),
    partial: count("partial"),
    incorrect: count("incorrect"),
    unclear: count("unclear"),
    groups: groups.length,
    inGroups: groups.reduce((n, m) => n + m.studentIds.length, 0),
    review: a.misconceptions.find((m) => m.id === REVIEW_ID)?.studentIds.length ?? 0,
  };
}

const names = (ids: string[], roster: Record<string, string>) => ids.map((id) => roster[id] ?? id).join(", ");

/** Lesson plan as Markdown, with real names put back locally. */
export function toMarkdown(s: Session): string {
  const a = s.analysis;
  const sum = summarise(a);
  const out: string[] = [];
  out.push(`# Re-teach plan: ${s.task.question}`, "");
  if (s.task.context) out.push(`_${s.task.context}_`, "");
  out.push(`${sum.correct} of ${sum.total} correct. ${sum.inGroups} students in ${sum.groups} misconception group(s), ${sum.review} to look at individually.`, "");
  for (const m of a.misconceptions) {
    const plan = a.plans.find((p) => p.misconceptionId === m.id);
    out.push(`## ${m.id === REVIEW_ID ? "" : m.id + ". "}${m.title} (${m.studentIds.length})`);
    out.push(`Students: ${names(m.studentIds, s.roster)}`, "");
    if (m.id !== REVIEW_ID) {
      out.push(`**What they think:** ${m.belief}`, "", `**Why it happens:** ${m.whyItHappens}`, "");
      for (const e of m.evidence) out.push(`> "${reidentify(e.quote, s.roster)}" (${s.roster[e.studentId] ?? e.studentId})${e.verified ? "" : " [quote not verified]"}`);
      out.push("");
    }
    if (plan) {
      out.push("**5-minute re-teach**", "");
      plan.steps.forEach((st, i) => out.push(`${i + 1}. (${st.minutes} min) ${st.action}`));
      out.push("", `**Contrast example:** ${plan.contrastExample}`, "", "**Check questions**", "");
      for (const q of plan.checkQuestions) out.push(`- ${q.question} Answer: ${q.answer}. Still stuck if: ${q.revealsIf}`);
      out.push("", `**Note for these students:** ${plan.studentNote}`, "");
    }
  }
  out.push("---", "Drafted with MistakeMap. AI suggestions, checked and edited by the teacher. No grades were assigned.");
  return out.join("\n");
}
