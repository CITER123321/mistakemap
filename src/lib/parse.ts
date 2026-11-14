export interface RawEntry {
  name: string;
  text: string;
}

const MAX_NAME = 40;

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function looksLikeName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > MAX_NAME) return false;
  if (/\d/.test(t)) return false;
  if (t.split(/\s+/).length > 4) return false;
  return /^[\p{L}][\p{L}'’. -]*$/u.test(t);
}

/** CSV export from a form or spreadsheet: first row is a header with a "name" and an "answer"-like column. */
function tryCsv(lines: string[]): RawEntry[] | null {
  const header = lines[0];
  const sep = header.includes("\t") ? "\t" : header.includes(";") && !header.includes(",") ? ";" : ",";
  const cols = splitCsvLine(header, sep).map((c) => c.toLowerCase());
  const nameIdx = cols.findIndex((c) => /^(name|student|student name|imię|imie|uczeń|uczen)$/.test(c));
  const ansIdx = cols.findIndex((c) => /(answer|response|odpowied)/.test(c));
  if (nameIdx < 0 || ansIdx < 0) return null;
  const out: RawEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, sep);
    const text = (cells[ansIdx] ?? "").trim();
    if (!text) continue;
    out.push({ name: (cells[nameIdx] ?? "").trim() || `Student ${out.length + 1}`, text });
  }
  return out;
}

/**
 * Accepts what teachers actually paste:
 *  - "Ana: 2/5 because I added the tops and bottoms"
 *  - "Ana<TAB>2/5" (copied from a spreadsheet)
 *  - a CSV with a header row (name, answer)
 *  - just answers, one per line (they become Student 1, Student 2, ...)
 * Lines that start with whitespace continue the previous answer.
 */
export function parseAnswers(raw: string): RawEntry[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return [];

  const csv = nonEmpty.length > 1 ? tryCsv(nonEmpty) : null;
  if (csv && csv.length) return csv;

  const out: RawEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && out.length) {
      out[out.length - 1].text += " " + line.trim();
      continue;
    }
    const tab = line.indexOf("\t");
    if (tab > 0 && looksLikeName(line.slice(0, tab))) {
      out.push({ name: line.slice(0, tab).trim(), text: line.slice(tab + 1).trim() });
      continue;
    }
    const m = /^([^:–—-]{1,40}?)\s*(?::|\s[-–—]\s)\s*(.+)$/.exec(line);
    if (m && looksLikeName(m[1])) {
      out.push({ name: m[1].trim(), text: m[2].trim() });
      continue;
    }
    out.push({ name: `Student ${out.length + 1}`, text: line.trim() });
  }
  return out.filter((e) => e.text.length > 0);
}
