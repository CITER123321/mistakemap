import type { Answer, ClusterResult, Grade, Misconception, ReteachPlan } from "./types";

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,…]+|[\s"'.,…]+$/g, "")
    .trim();
}

export function quoteIsInAnswer(quote: string, answer: string): boolean {
  const q = normalise(quote).replace(/\.\.\.|…/g, "  ");
  if (q.length < 2) return false;
  const a = normalise(answer);
  // Allow the model to elide the middle of a long quote with "..."
  return q
    .split(/\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .every((part) => a.includes(part));
}

export const REVIEW_ID = "REVIEW";

/**
 * The model proposes groups; this function decides what the teacher sees.
 *  - every not-correct student ends up in exactly one group
 *  - ids the model invented are dropped
 *  - each quote is checked against the real answer text, word for word
 *  - anything the model could not place goes to "Needs a closer look"
 */
export function verifyClusters(
  raw: ClusterResult,
  answers: Answer[],
  grades: Grade[],
): { misconceptions: Misconception[]; notes: string[] } {
  const notes: string[] = [];
  const byId = new Map(answers.map((a) => [a.id, a]));
  const verdict = new Map(grades.map((g) => [g.id, g.verdict]));
  const targets = new Set(answers.filter((a) => (verdict.get(a.id) ?? "unclear") !== "correct").map((a) => a.id));
  const assigned = new Set<string>();
  let invented = 0;
  let duplicates = 0;
  let unverified = 0;

  const groups: Misconception[] = [];
  for (const m of raw.misconceptions) {
    const ids: string[] = [];
    for (const id of m.studentIds) {
      if (!byId.has(id)) {
        invented++;
        continue;
      }
      if (!targets.has(id)) continue; // graded correct: does not belong in a mistake group
      if (assigned.has(id) || ids.includes(id)) {
        duplicates++;
        continue;
      }
      ids.push(id);
    }
    if (ids.length === 0) continue;
    ids.forEach((id) => assigned.add(id));

    const warnings: string[] = [];
    const evidence = m.evidence
      .filter((e) => ids.includes(e.studentId))
      .map((e) => {
        const ok = quoteIsInAnswer(e.quote, byId.get(e.studentId)!.text);
        if (!ok) unverified++;
        return { studentId: e.studentId, quote: e.quote.trim(), verified: ok };
      });
    const okCount = evidence.filter((e) => e.verified).length;
    if (okCount === 0) warnings.push("No quote could be matched to a real answer. Check this group yourself.");
    else if (okCount < evidence.length) warnings.push(`${evidence.length - okCount} quote(s) did not match the student's words and are marked.`);
    if (ids.length === 1) warnings.push("Only one student. Could be a one-off slip rather than a shared misconception.");

    groups.push({ ...m, id: "", studentIds: ids, evidence, warnings });
  }

  const leftovers = [...targets].filter((id) => !assigned.has(id));
  groups.sort((a, b) => b.studentIds.length - a.studentIds.length);
  groups.forEach((g, i) => (g.id = `M${i + 1}`));

  if (leftovers.length) {
    groups.push({
      id: REVIEW_ID,
      title: "Needs a closer look",
      belief: "These answers did not fit a shared pattern with enough confidence.",
      whyItHappens: "Could be unclear handwriting, an unusual method, a blank answer, or a one-off slip.",
      severity: "moderate",
      studentIds: leftovers.sort(),
      evidence: [],
      warnings: [],
    });
  }

  if (invented) notes.push(`Dropped ${invented} student id(s) the model made up.`);
  if (duplicates) notes.push(`${duplicates} student(s) were placed in two groups; kept the first.`);
  if (unverified) notes.push(`${unverified} quote(s) could not be found word for word and are marked as unverified.`);
  return { misconceptions: groups, notes };
}

export function verifyPlans(plans: ReteachPlan[], misconceptions: Misconception[]): { plans: ReteachPlan[]; notes: string[] } {
  const ids = new Set(misconceptions.filter((m) => m.id !== REVIEW_ID).map((m) => m.id));
  const kept = new Map<string, ReteachPlan>();
  for (const p of plans) if (ids.has(p.misconceptionId) && !kept.has(p.misconceptionId)) kept.set(p.misconceptionId, p);
  const notes: string[] = [];
  const missing = [...ids].filter((id) => !kept.has(id));
  if (missing.length) notes.push(`No plan came back for ${missing.join(", ")}.`);
  return { plans: [...kept.values()], notes };
}
