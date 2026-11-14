import { describe, expect, it } from "vitest";
import { quoteIsInAnswer, REVIEW_ID, verifyClusters, verifyPlans } from "@/lib/verify";
import type { Answer, Grade } from "@/lib/types";

const answers: Answer[] = [
  { id: "S01", text: "1+1 = 2 and 2+3 = 5 so 2/5" },
  { id: "S02", text: "You add the top numbers and the bottom numbers, 2/5" },
  { id: "S03", text: "5/6" },
  { id: "S04", text: "no idea" },
];
const grades: Grade[] = [
  { id: "S01", verdict: "incorrect", confidence: 0.9, reason: "" },
  { id: "S02", verdict: "incorrect", confidence: 0.9, reason: "" },
  { id: "S03", verdict: "correct", confidence: 0.9, reason: "" },
  { id: "S04", verdict: "unclear", confidence: 0.9, reason: "" },
];
const base = { title: "Adds tops and bottoms", belief: "x", whyItHappens: "y", severity: "fundamental" as const };

describe("quoteIsInAnswer", () => {
  it("matches ignoring case, curly quotes and spacing", () => {
    expect(quoteIsInAnswer("YOU ADD  the top numbers", "You add the top numbers and")).toBe(true);
    expect(quoteIsInAnswer("“2/5”", "so 2/5")).toBe(true);
  });
  it("accepts an elided quote only if every part is real", () => {
    expect(quoteIsInAnswer("You add ... bottom numbers", answers[1].text)).toBe(true);
    expect(quoteIsInAnswer("You add ... the denominators", answers[1].text)).toBe(false);
  });
  it("rejects paraphrases", () => {
    expect(quoteIsInAnswer("adds numerators and denominators", answers[1].text)).toBe(false);
  });
});

describe("verifyClusters", () => {
  it("drops invented ids, correct students and duplicates, and sends leftovers to review", () => {
    const { misconceptions, notes } = verifyClusters(
      {
        misconceptions: [
          { ...base, studentIds: ["S01", "S03", "S99"], evidence: [{ studentId: "S01", quote: "2+3 = 5" }] },
          { ...base, title: "Other", studentIds: ["S01"], evidence: [] },
        ],
        unassigned: [],
      },
      answers,
      grades,
    );
    expect(misconceptions.map((m) => m.id)).toEqual(["M1", REVIEW_ID]);
    expect(misconceptions[0].studentIds).toEqual(["S01"]);
    expect(misconceptions[1].studentIds).toEqual(["S02", "S04"]);
    expect(notes.join(" ")).toMatch(/made up/);
    expect(notes.join(" ")).toMatch(/two groups/);
  });
  it("marks quotes that are not in the answer as unverified and warns", () => {
    const { misconceptions } = verifyClusters(
      { misconceptions: [{ ...base, studentIds: ["S01", "S02"], evidence: [{ studentId: "S02", quote: "I add denominators" }] }], unassigned: [] },
      answers,
      grades,
    );
    expect(misconceptions[0].evidence[0].verified).toBe(false);
    expect(misconceptions[0].warnings[0]).toMatch(/No quote/);
  });
  it("ignores evidence attributed to students outside the group", () => {
    const { misconceptions } = verifyClusters(
      { misconceptions: [{ ...base, studentIds: ["S01"], evidence: [{ studentId: "S02", quote: "You add" }] }], unassigned: [] },
      answers,
      grades,
    );
    expect(misconceptions[0].evidence).toEqual([]);
  });
  it("orders groups by size", () => {
    const { misconceptions } = verifyClusters(
      {
        misconceptions: [
          { ...base, title: "small", studentIds: ["S04"], evidence: [] },
          { ...base, title: "big", studentIds: ["S01", "S02"], evidence: [] },
        ],
        unassigned: [],
      },
      answers,
      grades,
    );
    expect(misconceptions.map((m) => m.title)).toEqual(["big", "small"]);
  });
});

describe("verifyPlans", () => {
  it("keeps one plan per known misconception and reports missing ones", () => {
    const ms = verifyClusters({ misconceptions: [{ ...base, studentIds: ["S01", "S02"], evidence: [] }], unassigned: [] }, answers, grades).misconceptions;
    const plan = { misconceptionId: "M1", steps: [], contrastExample: "", checkQuestions: [], studentNote: "" };
    expect(verifyPlans([plan, plan, { ...plan, misconceptionId: "M9" }], ms).plans).toHaveLength(1);
    expect(verifyPlans([], ms).notes[0]).toMatch(/M1/);
  });
});
