import { describe, expect, it } from "vitest";
import { pseudonymise, reidentify } from "@/lib/privacy";

describe("pseudonymise", () => {
  it("replaces names with ids, including names mentioned inside other answers", () => {
    const p = pseudonymise([
      { name: "Ana Nowak", text: "2/5" },
      { name: "Ben Fischer", text: "same as Ana, I copied from ana nowak" },
    ]);
    expect(p.answers.map((a) => a.id)).toEqual(["S01", "S02"]);
    expect(p.answers[1].text).toBe("same as S01, I copied from S01");
    expect(JSON.stringify(p.answers)).not.toMatch(/ana|nowak|fischer/i);
    expect(p.roster).toEqual({ S01: "Ana Nowak", S02: "Ben Fischer" });
  });
  it("removes e-mails and phone numbers but keeps long decimals", () => {
    const p = pseudonymise([{ name: "Kim", text: "mail kim.k@school.edu or 608 659 879, answer 0.8333333333" }]);
    expect(p.answers[0].text).toBe("mail [email removed] or [phone removed], answer 0.8333333333");
    expect(p.redactions).toBe(2);
  });
  it("does not replace parts of other words", () => {
    const p = pseudonymise([{ name: "Theo", text: "my theory is wrong" }]);
    expect(p.answers[0].text).toBe("my theory is wrong");
  });
  it("catches inflected forms of longer names (Polish)", () => {
    const p = pseudonymise([
      { name: "Zofia Wiśniewska", text: "14" },
      { name: "Jan", text: "zapytaj Zofii albo pani Wiśniewskiej" },
    ]);
    expect(p.answers[1].text).toBe("zapytaj S01 albo pani S01");
  });
  it("puts names back for display", () => {
    expect(reidentify("S01 and S02", { S01: "Ana", S02: "Ben" })).toBe("Ana and Ben");
  });
});
