import type { Answer } from "./types";
import type { RawEntry } from "./parse";

export interface Pseudonymised {
  answers: Answer[];
  /** id -> real name. Lives only in the browser (localStorage), never sent to the server. */
  roster: Record<string, string>;
  redactions: number;
}

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu;
// Formatted phone numbers only, so long decimals such as 0.8333333 are left alone.
const PHONE = /(?<![\d.,/])(?:\+\d{1,3}[\s-]?)?\d{3}[\s-]\d{3}[\s-]\d{3,4}(?![\d.])|\+\d{9,13}(?!\d)/g;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function idFor(index: number): string {
  return "S" + String(index + 1).padStart(2, "0");
}

/**
 * Replaces student names with ids (S01, S02, ...) and strips e-mails and phone numbers
 * BEFORE anything leaves the browser. If one student mentions another by name
 * ("I copied from Ana"), that name is replaced with Ana's id too.
 */
export function pseudonymise(entries: RawEntry[]): Pseudonymised {
  const roster: Record<string, string> = {};
  entries.forEach((e, i) => (roster[idFor(i)] = e.name));

  // Name parts worth hiding: full names and individual words of 3+ letters ("Ana", "Kowalski").
  const parts: Array<{ re: RegExp; id: string; len: number }> = [];
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    if (/^Student \d+$/.test(e.name)) return;
    const words = [e.name, ...e.name.split(/\s+/)].map((w) => w.trim()).filter((w) => w.length >= 3);
    for (const w of words) {
      const key = w.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Names of 5+ letters also match common inflected forms (Zofia -> Zofii, Zofią), which matters in Polish and similar languages.
      const body = w.length >= 5 && !/\s/.test(w) ? `${escapeRe(w.slice(0, -1))}\\p{L}{0,3}` : escapeRe(w);
      parts.push({ re: new RegExp(`(?<![\\p{L}])${body}(?![\\p{L}])`, "giu"), id: idFor(i), len: w.length });
    }
  });
  // Longest first, so "Ana Nowak" is replaced before "Ana".
  parts.sort((a, b) => b.len - a.len);

  let redactions = 0;
  const answers: Answer[] = entries.map((e, i) => {
    let text = e.text.slice(0, 1200);
    text = text.replace(EMAIL, () => (redactions++, "[email removed]"));
    text = text.replace(PHONE, () => (redactions++, "[phone removed]"));
    for (const p of parts) text = text.replace(p.re, () => (redactions++, p.id));
    return { id: idFor(i), text };
  });

  return { answers, roster, redactions };
}

/** Puts real names back for display. Runs in the browser only. */
export function reidentify(text: string, roster: Record<string, string>): string {
  return text.replace(/\bS\d{2,3}\b/g, (id) => roster[id] ?? id);
}
