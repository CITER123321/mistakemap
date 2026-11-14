import { describe, expect, it } from "vitest";
import { parseAnswers } from "@/lib/parse";

describe("parseAnswers", () => {
  it("reads 'Name: answer' lines", () => {
    expect(parseAnswers("Ana Nowak: 2/5\nBen: 5/6")).toEqual([
      { name: "Ana Nowak", text: "2/5" },
      { name: "Ben", text: "5/6" },
    ]);
  });
  it("does not treat a maths expression before a colon as a name", () => {
    expect(parseAnswers("1/2 + 1/3: add the tops")[0]).toEqual({ name: "Student 1", text: "1/2 + 1/3: add the tops" });
  });
  it("reads tab-separated rows copied from a spreadsheet", () => {
    expect(parseAnswers("Ana\t2/5\nBen\t5/6")).toHaveLength(2);
  });
  it("reads CSV with a header and quoted commas", () => {
    const rows = parseAnswers('Timestamp,Name,Answer\n1,Ana,"2/5, because 1+1, 2+3"\n2,Ben,5/6');
    expect(rows).toEqual([
      { name: "Ana", text: "2/5, because 1+1, 2+3" },
      { name: "Ben", text: "5/6" },
    ]);
  });
  it("numbers bare answers and joins indented continuation lines", () => {
    const rows = parseAnswers("2/5\n  because I added\n5/6");
    expect(rows).toEqual([
      { name: "Student 1", text: "2/5 because I added" },
      { name: "Student 2", text: "5/6" },
    ]);
  });
  it("supports Polish names and a spaced dash separator", () => {
    expect(parseAnswers("Zofia Wiśniewska - z gleby")[0]).toEqual({ name: "Zofia Wiśniewska", text: "z gleby" });
  });
  it("ignores empty input", () => {
    expect(parseAnswers("  \n\n")).toEqual([]);
  });
});
