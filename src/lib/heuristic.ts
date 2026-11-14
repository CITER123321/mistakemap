/**
 * Offline mode: no AI, no network. Used when no API key is configured and the input is not
 * one of the bundled samples. It is deliberately simple and the UI says so: it can tell you
 * WHO gave the same wrong answer, but not WHY.
 */
import type { Answer, ClusterResult, Grade, Misconception, ReteachPlan, Task, Verdict } from "./types";

const STOP = new Set(
  "the a an and or but of to in on at for from with by is are was were be been it its this that these those as because so then than into out up down over under i we you they he she my our your their me not no yes do does did just very also there here what which who how why when where will would can could should about".split(
    " ",
  ),
);

export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(-?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)|(-?\d+(?:[.,]\d+)?)\s*%|(-?\d+(?:[.,]\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = (s: string) => parseFloat(s.replace(",", "."));
    if (m[1] && m[2]) {
      const d = n(m[2]);
      if (d !== 0) out.push(n(m[1]) / d);
    } else if (m[3]) out.push(n(m[3]) / 100);
    else if (m[4]) out.push(n(m[4]));
  }
  return out;
}

function close(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.01);
}

export function words(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 6));
}

const NUM_TOKEN = /-?\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?%?/g;

/** The student's final answer: after the last "=", else a number they started with, else the last number. */
export function finalAnswerToken(text: string): string | null {
  const eq = text.lastIndexOf("=");
  const scope = eq >= 0 ? text.slice(eq + 1) : text;
  const toks = scope.match(NUM_TOKEN) ?? (eq >= 0 ? text.match(NUM_TOKEN) : null);
  if (!toks) return null;
  const pick = eq < 0 && /^\s*-?\d/.test(text) ? toks[0] : toks[toks.length - 1];
  return pick.replace(/\s+/g, "");
}

export function gradeOffline(task: Task, answers: Answer[]): Grade[] {
  const key = task.answerKey.trim();
  const keyNums = numbersIn(key);
  const keyWords = [...new Set(words(key))];
  return answers.map((a) => {
    const text = a.text.trim();
    let verdict: Verdict = "unclear";
    let reason = "No answer key, so the offline checker cannot judge this.";
    if (!text || /^(idk|\?+|-+|n\/?a|i don'?t know|nie wiem)$/i.test(text)) {
      verdict = "unclear";
      reason = "Blank or 'don't know'.";
    } else if (keyNums.length) {
      const target = keyNums[0];
      const nums = numbersIn(text);
      if (nums.some((n) => close(n, target))) {
        verdict = "correct";
        reason = "Contains the value from the answer key.";
      } else if (nums.length) {
        verdict = "incorrect";
        reason = "Gives a different value from the answer key.";
      } else {
        verdict = "unclear";
        reason = "No number found to compare with the key.";
      }
    } else if (keyWords.length) {
      const w = new Set(words(text));
      const hit = keyWords.filter((k) => w.has(k)).length / keyWords.length;
      verdict = hit >= 0.6 ? "correct" : hit >= 0.3 ? "partial" : "incorrect";
      reason = `Shares ${Math.round(hit * 100)}% of the key words.`;
    }
    return { id: a.id, verdict, confidence: 0.4, reason };
  });
}

function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

function excerpt(text: string, max = 140) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return cut.slice(0, sp > 60 ? sp : max);
}

export function clusterOffline(task: Task, answers: Answer[], grades: Grade[]): ClusterResult {
  const verdict = new Map(grades.map((g) => [g.id, g.verdict]));
  const wrong = answers.filter((a) => verdict.get(a.id) !== "correct" && a.text.trim());
  const numericKey = numbersIn(task.answerKey).length > 0;

  type G = { label: string; ids: string[]; vocab: Set<string>; samples: Answer[] };
  const groups: G[] = [];
  for (const a of wrong) {
    if (verdict.get(a.id) === "unclear" && !numericKey) continue;
    if (numericKey) {
      const tok = finalAnswerToken(a.text);
      if (!tok) continue;
      const val = numbersIn(tok)[0];
      const g = groups.find((x) => numbersIn(x.label).some((v) => close(v, val)));
      if (g) {
        g.ids.push(a.id);
        g.samples.push(a);
      } else groups.push({ label: tok, ids: [a.id], vocab: new Set(), samples: [a] });
    } else {
      const v = new Set(words(a.text));
      let best: G | null = null;
      let bestScore = 0;
      for (const g of groups) {
        const s = jaccard(v, g.vocab);
        if (s > bestScore) {
          best = g;
          bestScore = s;
        }
      }
      if (best && bestScore >= 0.25) {
        best.ids.push(a.id);
        best.samples.push(a);
        v.forEach((w) => best!.vocab.add(w));
      } else groups.push({ label: "", ids: [a.id], vocab: v, samples: [a] });
    }
  }

  const shared = groups.filter((g) => g.ids.length >= 2);
  return {
    misconceptions: shared.map((g) => {
      let label = g.label;
      if (!numericKey) {
        const counts = new Map<string, number>();
        for (const s of g.samples) for (const w of new Set(words(s.text))) counts.set(w, (counts.get(w) ?? 0) + 1);
        const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([w]) => `“${w}…”`);
        label = top.join(" + ");
      }
      return {
        title: numericKey ? `Same wrong answer: ${label}` : `Similar wording: ${label}`,
        belief: `${g.ids.length} students gave ${numericKey ? "the same wrong answer" : "answers built from the same words"}. Offline mode can group them, but it cannot explain the reasoning.`,
        whyItHappens: "Add an API key to get an explanation of the likely reasoning error.",
        severity: "moderate" as const,
        studentIds: g.ids,
        evidence: g.samples.slice(0, 2).map((s) => ({ studentId: s.id, quote: excerpt(s.text) })),
      };
    }),
    unassigned: [],
  };
}

export function planOffline(task: Task, misconceptions: Misconception[], answers: Answer[]): ReteachPlan[] {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return misconceptions
    .filter((m) => m.id !== "REVIEW")
    .map((m) => {
      const sample = m.evidence[0]?.quote ?? byId.get(m.studentIds[0])?.text ?? "";
      return {
        misconceptionId: m.id,
        steps: [
          { minutes: 2, action: `Put one anonymous answer from this group on the board (“${excerpt(sample, 80)}”) and ask the class to find the exact step where it goes wrong.` },
          { minutes: 2, action: "Ask a student from the group to explain their method out loud, then work the problem together next to the correct solution." },
          { minutes: 1, action: "Give one similar question with new numbers or a new example and check the group's answers." },
        ],
        contrastExample: `Write the worked solution next to “${excerpt(sample, 80)}” and compare them line by line.`,
        checkQuestions: [
          {
            question: `Ask the same kind of question again with different values: ${excerpt(task.question, 100)}`,
            answer: "Depends on the new values.",
            revealsIf: "The student repeats the same method that led to the original answer.",
          },
        ],
        studentNote: "Your answer showed a pattern several classmates also had. We will go through it together in the next lesson.",
      };
    });
}
