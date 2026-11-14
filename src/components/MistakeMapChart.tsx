"use client";

import { hierarchy, pack } from "d3-hierarchy";
import { useMemo, useState } from "react";
import type { Misconception } from "@/lib/types";

interface Node {
  key: string;
  label: string;
  count: number;
  kind: "correct" | "miss" | "review";
  severity?: string;
}

const W = 520;
const H = 420;

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

export function MistakeMapChart({ misconceptions, correct, total }: { misconceptions: Misconception[]; correct: number; total: number }) {
  const [hover, setHover] = useState<string | null>(null);

  const nodes = useMemo(() => {
    const children: Node[] = [
      ...misconceptions
        .filter((m) => m.studentIds.length > 0)
        .map((m) => ({
          key: m.id,
          label: m.id === "REVIEW" ? m.title : `${m.id}. ${m.title}`,
          count: m.studentIds.length,
          kind: m.id === "REVIEW" ? ("review" as const) : ("miss" as const),
          severity: m.severity,
        })),
    ];
    if (correct > 0) children.push({ key: "correct", label: "Correct", count: correct, kind: "correct" });
    const root = hierarchy<{ children?: Node[] } | Node>({ children } as { children: Node[] })
      .sum((d) => ("count" in d ? d.count : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return pack<{ children?: Node[] } | Node>().size([W, H]).padding(10)(root).leaves();
  }, [misconceptions, correct]);

  const describe = nodes.map((n) => `${(n.data as Node).label}: ${(n.data as Node).count}`).join("; ");

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Bubble map of the class (${total} students). ${describe}`}>
        {nodes.map((n) => {
          const d = n.data as Node;
          const color = d.kind === "correct" ? "var(--ok)" : d.kind === "review" ? "var(--review)" : "var(--miss)";
          const r = n.r;
          const pct = Math.round((d.count / Math.max(1, total)) * 100);
          const head = d.kind === "miss" ? d.key : d.kind === "correct" ? "Correct" : "Review";
          const title = d.kind === "miss" ? d.label.replace(/^M\d+\.\s*/, "") : "";
          const body = r > 58 && title ? wrap(title, Math.max(9, Math.floor(r / 4.6)), 3) : [];
          const lines = r > 22 ? [head, ...body] : [];
          const isHover = hover === d.key;
          const href = d.kind === "correct" ? "#students" : `#${d.key}`;
          return (
            <a
              key={d.key}
              href={href}
              className="bubble"
              style={{ transformOrigin: `${n.x}px ${n.y}px`, transformBox: "view-box" }}
              onMouseEnter={() => setHover(d.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(d.key)}
              onBlur={() => setHover(null)}
              aria-label={`${d.label}: ${d.count} students, ${pct}% of the class`}
            >
              <title>{`${d.label}: ${d.count} student${d.count === 1 ? "" : "s"} (${pct}%)`}</title>
              <circle
                cx={n.x}
                cy={n.y}
                r={r}
                fill={color}
                fillOpacity={isHover ? 0.32 : 0.2}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={d.kind === "review" ? "6 5" : undefined}
              />
              {lines.map((l, i) => (
                <text
                  key={i}
                  x={n.x}
                  y={n.y - (lines.length * 15) / 2 + i * 15 + 2}
                  textAnchor="middle"
                  fontSize={i === 0 ? 14 : 12.5}
                  fontWeight={i === 0 ? 700 : 500}
                  fill="var(--ink)"
                >
                  {l}
                </text>
              ))}
              {r > 22 && (
                <text x={n.x} y={n.y + (lines.length * 15) / 2 + 12} textAnchor="middle" fontSize={12} fill="var(--ink-2)">
                  {d.count} · {pct}%
                </text>
              )}
            </a>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <Legend color="var(--miss)" label="Misconception group" />
        <Legend color="var(--review)" label="Needs a closer look" dashed />
        <Legend color="var(--ok)" label="Correct" />
        <span className="text-ink-3">Bubble size = number of students. Click a bubble to jump to it.</span>
      </figcaption>
    </figure>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="14" height="14" aria-hidden>
        <circle cx="7" cy="7" r="6" fill={color} fillOpacity={0.2} stroke={color} strokeWidth={2} strokeDasharray={dashed ? "3 2" : undefined} />
      </svg>
      {label}
    </span>
  );
}

export function CompositionBar({ correct, groups, review, total }: { correct: number; groups: number; review: number; total: number }) {
  const segs = [
    { label: "Correct", n: correct, color: "var(--ok)" },
    { label: "In a misconception group", n: groups, color: "var(--miss)" },
    { label: "Needs a closer look", n: review, color: "var(--review)" },
  ].filter((s) => s.n > 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={segs.map((s) => `${s.label}: ${s.n}`).join(", ")}>
        {segs.map((s) => (
          <div key={s.label} style={{ width: `${(s.n / Math.max(1, total)) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        {segs.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}: <strong className="font-semibold text-ink">{s.n}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
