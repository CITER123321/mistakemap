import type { Answer } from "./types";

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|forget)\b[^.]{0,40}\b(instructions?|rules|prompt|above)\b/i, "asks the AI to ignore its instructions"],
  [/\b(mark|grade|score|count)\b[^.]{0,30}\b(this|me|my answer|it)\b[^.]{0,20}\b(correct|right|full marks?|100|an? A)\b/i, "asks the AI to mark it correct"],
  [/\b(system prompt|developer message|you are (now )?an? (ai|assistant|grader))\b/i, "talks to the AI directly"],
  [/\b(as an ai|dear (ai|chatgpt|claude|gemini)|hey (ai|chatgpt|claude|gemini))\b/i, "talks to the AI directly"],
];

/**
 * Student answers are data, not instructions. The prompts already say so; this check
 * additionally shows the teacher when a student tried to talk to the grader.
 */
export function detectInjection(answers: Answer[]) {
  const flags: Array<{ studentId: string; kind: "prompt-injection"; detail: string }> = [];
  for (const a of answers) {
    for (const [re, detail] of PATTERNS) {
      if (re.test(a.text)) {
        flags.push({ studentId: a.id, kind: "prompt-injection", detail });
        break;
      }
    }
  }
  return flags;
}
