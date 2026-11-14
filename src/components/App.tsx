"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectInjection } from "@/lib/injection";
import { parseAnswers } from "@/lib/parse";
import { pseudonymise, reidentify } from "@/lib/privacy";
import { SAMPLES } from "@/lib/samples";
import { moveStudent, renameGroup, setVerdict, summarise, toMarkdown, type Session } from "@/lib/session";
import type { Analysis, Grade, Misconception, ReteachPlan, StepMeta, Task, Verdict } from "@/lib/types";
import { CompositionBar, MistakeMapChart } from "./MistakeMapChart";

const STORE_KEY = "mistakemap:last-session:v1";

type StepState = "todo" | "doing" | "done" | "error";
const STEPS = [
  { key: "privacy", label: "Hide names on this device" },
  { key: "grade", label: "Check every answer" },
  { key: "cluster", label: "Group students by the reasoning behind the mistake" },
  { key: "verify", label: "Verify every quote against the real answers" },
  { key: "plan", label: "Draft a 5-minute re-teach for each group" },
] as const;

interface Status {
  live: boolean;
  provider: string;
  model: string;
  maxAnswers: number;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`);
  return data as T;
}

function loadStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function store(s: Session | null) {
  try {
    if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode: the app still works, it just won't remember the last class */
  }
}

async function fileToImage(file: File): Promise<{ mediaType: "image/jpeg"; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: url.split(",")[1] };
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [task, setTask] = useState<Task>({ question: "", answerKey: "", context: "" });
  const [raw, setRaw] = useState("");
  const [sampleId, setSampleId] = useState<string | undefined>();
  const [session, setSession] = useState<Session | null>(null);
  const [steps, setSteps] = useState<Record<string, StepState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ live: false, provider: "none", model: "demo", maxAnswers: 60 }));
    const s = loadStored();
    if (s) {
      setSession(s);
      setTask(s.task);
      setRaw(s.raw);
      setSampleId(s.sampleId);
    }
    const openAll = () => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
    window.addEventListener("beforeprint", openAll);
    return () => window.removeEventListener("beforeprint", openAll);
  }, []);

  const parsed = useMemo(() => parseAnswers(raw), [raw]);
  const preview = useMemo(() => pseudonymise(parsed), [parsed]);

  function loadSample(id: string) {
    const s = SAMPLES.find((x) => x.id === id)!;
    setTask({ ...s.task });
    setRaw(s.raw);
    setSampleId(id);
    setError(null);
  }

  function updateSession(fn: (a: Analysis) => Analysis) {
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, analysis: fn(s.analysis) };
      store(next);
      return next;
    });
  }

  async function run() {
    setError(null);
    if (task.question.trim().length < 3) return setError("Type the question your students answered.");
    if (parsed.length === 0) return setError("Paste at least one student answer.");
    const max = status?.maxAnswers ?? 60;
    if (parsed.length > max) return setError(`This demo handles up to ${max} answers at a time.`);

    setBusy(true);
    setSession(null);
    const st: Record<string, StepState> = Object.fromEntries(STEPS.map((s) => [s.key, "todo"]));
    const mark = (k: string, v: StepState) => setSteps({ ...Object.assign(st, { [k]: v }) });
    try {
      mark("privacy", "doing");
      const { answers, roster, redactions } = pseudonymise(parsed);
      const flags = detectInjection(answers);
      mark("privacy", "done");

      mark("grade", "doing");
      const g = await post<{ grades: Grade[]; meta: StepMeta }>("/api/grade", { task, answers });
      mark("grade", "done");

      mark("cluster", "doing");
      const c = await post<{ misconceptions: Misconception[]; meta: StepMeta }>("/api/cluster", { task, answers, grades: g.grades });
      mark("cluster", "done");
      mark("verify", "done");

      mark("plan", "doing");
      const p = await post<{ plans: ReteachPlan[]; meta: StepMeta }>("/api/plan", { task, answers, misconceptions: c.misconceptions });
      mark("plan", "done");

      const s: Session = {
        task,
        raw,
        answers,
        roster,
        redactions,
        sampleId,
        createdAt: new Date().toISOString(),
        analysis: { grades: g.grades, misconceptions: c.misconceptions, plans: p.plans, flags, meta: [g.meta, c.meta, p.meta] },
      };
      setSession(s);
      store(s);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      const k = Object.keys(st).find((x) => st[x] === "doing");
      if (k) mark(k, "error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setPhotoBusy(true);
    try {
      const images = await Promise.all([...files].slice(0, 6).map(fileToImage));
      const out = await post<{ sheets: Array<{ label: string; text: string }> }>("/api/transcribe", { images });
      const lines = out.sheets.map((s) => `${s.label.replace(/[:\n]/g, " ").trim() || "Sheet"}: ${s.text.replace(/\n+/g, " ").trim()}`);
      setRaw((r) => (r.trim() ? r.trim() + "\n" : "") + lines.join("\n"));
      setSampleId(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onCsv(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setRaw(await f.text());
    setSampleId(undefined);
  }

  function reset() {
    setSession(null);
    setSteps(null);
    store(null);
    setTask({ question: "", answerKey: "", context: "" });
    setRaw("");
    setSampleId(undefined);
    window.scrollTo({ top: 0 });
  }

  async function copyMarkdown() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(session));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy. Use Download instead.");
    }
  }

  function download() {
    if (!session) return;
    const blob = new Blob([toMarkdown(session)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mistakemap-reteach-plan.md";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <Header status={status} />

      <section className="no-print pt-6 pb-8 sm:pt-10">
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
          Half the class got it wrong.
          <br />
          <span className="text-accent">Find out why in a minute.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-2">
          Paste your students&apos; answers to one question. MistakeMap groups them by the <em>reasoning</em> behind each mistake, quotes the
          students&apos; own words as proof, and drafts a 5-minute re-teach for tomorrow&apos;s lesson. It never grades anyone.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-ink-3">Try a sample class:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSample(s.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${sampleId === s.id ? "border-accent bg-accent text-accent-ink" : "border-line bg-card hover:border-accent"}`}
            >
              <span aria-hidden>{s.emoji}</span> {s.label}
            </button>
          ))}
        </div>
      </section>

      <div className="no-print grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2" step="1" title="The question">
          <Field label="Question your students answered">
            <textarea
              value={task.question}
              onChange={(e) => {
                setTask({ ...task, question: e.target.value });
                setSampleId(undefined);
              }}
              rows={3}
              placeholder="e.g. Work out 1/2 + 1/3. Show how you got your answer."
              className="w-full rounded-lg border border-line bg-paper p-3"
            />
          </Field>
          <Field label="Answer key or what a good answer includes" hint="Optional, but it makes the check much more reliable.">
            <textarea
              value={task.answerKey}
              onChange={(e) => setTask({ ...task, answerKey: e.target.value })}
              rows={3}
              placeholder="e.g. 5/6, using a common denominator of 6"
              className="w-full rounded-lg border border-line bg-paper p-3"
            />
          </Field>
          <Field label="Class (optional)">
            <input
              value={task.context}
              onChange={(e) => setTask({ ...task, context: e.target.value })}
              placeholder="e.g. Year 7 maths, fractions"
              className="w-full rounded-lg border border-line bg-paper p-2.5"
            />
          </Field>
        </Card>

        <Card className="lg:col-span-3" step="2" title="The answers">
          <Field label="One student per line" hint="“Name: answer”, a column copied from a spreadsheet, or a CSV export from your form tool.">
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setSampleId(undefined);
              }}
              rows={11}
              placeholder={"Ana: 2/5 because 1+1 is 2 and 2+3 is 5\nBen: 3/6 + 2/6 = 5/6\n..."}
              className="w-full rounded-lg border border-line bg-paper p-3 font-mono text-sm leading-relaxed"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="cursor-pointer rounded-lg border border-line bg-card px-3 py-1.5 hover:border-accent">
              Upload CSV
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => onCsv(e.target.files)} />
            </label>
            <label
              className={`rounded-lg border border-line bg-card px-3 py-1.5 ${status?.live ? "cursor-pointer hover:border-accent" : "cursor-not-allowed opacity-60"}`}
              title={status?.live ? "Photos are sent to the AI provider for transcription. Cover full names first." : "Needs live AI (an API key on the server)"}
            >
              {photoBusy ? "Reading photos…" : "Photos of answer sheets"}
              <input type="file" accept="image/*" multiple className="sr-only" disabled={!status?.live || photoBusy} onChange={(e) => onPhotos(e.target.files)} />
            </label>
            <span className="text-ink-3">{parsed.length ? `${parsed.length} answers found` : ""}</span>
          </div>
          {parsed.length > 0 && (
            <details className="mt-3 rounded-lg border border-line bg-soft p-3 text-sm">
              <summary className="font-medium">
                🔒 What the AI will see <span className="font-normal text-ink-3">(names replaced on your device{preview.redactions ? `, ${preview.redactions} name/contact mentions removed` : ""})</span>
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
                {preview.answers.map((a) => `${a.id}: ${a.text}`).join("\n")}
              </pre>
            </details>
          )}
        </Card>
      </div>

      <div className="no-print mt-6 flex flex-wrap items-center gap-4">
        <button
          onClick={run}
          disabled={busy}
          className="rounded-xl bg-accent px-6 py-3 text-lg font-semibold text-accent-ink shadow-sm transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? "Mapping the mistakes…" : "Map the mistakes →"}
        </button>
        {!status?.live && status && (
          <span className="max-w-md text-sm text-ink-3">
            Demo mode: no API key on this server. Sample classes show a prepared analysis; your own answers get a simple offline grouping.
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="no-print mt-4 rounded-lg border border-line bg-warn-bg p-3 text-warn-ink">
          {error}
        </p>
      )}

      {steps && (busy || !session) && <Progress steps={steps} />}

      <div ref={resultsRef} className="scroll-mt-4">
        {session && <Results session={session} onChange={updateSession} onCopy={copyMarkdown} copied={copied} onDownload={download} onReset={reset} />}
      </div>

      <footer className="no-print mt-20 border-t border-line pt-6 text-sm text-ink-3">
        MistakeMap suggests; the teacher decides. It does not assign grades and should not be used for high-stakes decisions.{" "}
        <a href="/how-it-works" className="underline hover:text-accent">
          How it works and its limits
        </a>
        .
      </footer>
    </div>
  );
}

function Header({ status }: { status: Status | null }) {
  return (
    <header className="no-print flex items-center justify-between border-b border-line py-4">
      <a href="/" className="flex items-center gap-2 font-display text-xl font-semibold">
        <Logo /> MistakeMap
      </a>
      <div className="flex items-center gap-3 text-sm">
        {status && (
          <span className={`rounded-full border px-2.5 py-1 ${status.live ? "border-ok text-ok" : "border-line text-ink-3"}`}>
            {status.live ? `Live AI · ${status.model}` : "Demo mode"}
          </span>
        )}
        <a href="/how-it-works" className="hidden text-ink-2 hover:text-accent sm:inline">
          How it works
        </a>
      </div>
    </header>
  );
}

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <circle cx="12" cy="13" r="8" fill="var(--miss)" fillOpacity="0.25" stroke="var(--miss)" strokeWidth="2" />
      <circle cx="23" cy="20" r="6" fill="var(--ok)" fillOpacity="0.25" stroke="var(--ok)" strokeWidth="2" />
      <circle cx="12" cy="25" r="3.5" fill="var(--review)" fillOpacity="0.3" stroke="var(--review)" strokeWidth="2" />
    </svg>
  );
}

function Card({ step, title, children, className = "" }: { step?: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card rounded-2xl border border-line bg-card p-5 shadow-sm ${className}`}>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        {step && <span className="grid h-6 w-6 place-items-center rounded-full bg-soft text-sm text-ink-2">{step}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Progress({ steps }: { steps: Record<string, StepState> }) {
  return (
    <ol className="no-print mt-8 grid gap-2 rounded-2xl border border-line bg-card p-5" aria-live="polite">
      {STEPS.map((s) => {
        const v = steps[s.key];
        return (
          <li key={s.key} className={`flex items-center gap-3 ${v === "todo" ? "text-ink-3" : ""}`}>
            <span className="grid h-6 w-6 place-items-center" aria-hidden>
              {v === "done" ? "✓" : v === "doing" ? <span className="h-3 w-3 animate-ping rounded-full bg-accent" /> : v === "error" ? "✕" : "·"}
            </span>
            {s.label}
            {v === "doing" && <span className="text-sm text-ink-3">working…</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ModeBanner({ meta }: { meta: StepMeta[] }) {
  const modes = new Set(meta.map((m) => m.mode));
  if (modes.has("live")) {
    const m = meta.find((x) => x.mode === "live")!;
    return (
      <p className="rounded-lg border border-line bg-soft p-3 text-sm text-ink-2">
        <strong className="text-ink">Live analysis</strong> by {m.provider === "anthropic" ? "Claude" : "Gemini"} ({m.model}). Everything below is a
        suggestion: check it, move students, change verdicts.
      </p>
    );
  }
  if (modes.has("demo-fixture"))
    return (
      <p className="rounded-lg border border-line bg-warn-bg p-3 text-sm text-warn-ink">
        <strong>Demo data.</strong> No API key is set on this server, so this sample class shows an analysis prepared in advance in exactly the format the
        live AI returns. It still went through the same verification step. Run it with a key to see a live result.
      </p>
    );
  return (
    <p className="rounded-lg border border-line bg-warn-bg p-3 text-sm text-warn-ink">
      <strong>Offline mode, no AI.</strong> Answers were checked against the key with simple rules and grouped by identical wrong answers or shared words.
      It can show <em>who</em> made the same mistake, not <em>why</em>. Add an API key for the real analysis.
    </p>
  );
}

function Results({
  session,
  onChange,
  onCopy,
  copied,
  onDownload,
  onReset,
}: {
  session: Session;
  onChange: (fn: (a: Analysis) => Analysis) => void;
  onCopy: () => void;
  copied: boolean;
  onDownload: () => void;
  onReset: () => void;
}) {
  const a = session.analysis;
  const sum = summarise(a);
  const quotes = a.misconceptions.flatMap((m) => m.evidence);
  const verified = quotes.filter((q) => q.verified).length;
  const notes = a.meta.flatMap((m) => m.notes);
  const name = (id: string) => session.roster[id] ?? id;

  return (
    <div className="mt-12">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm tracking-wide text-ink-3 uppercase">Mistake map</p>
          <h2 className="font-display text-3xl font-semibold">{session.task.question}</h2>
          {session.task.context && <p className="text-ink-2">{session.task.context}</p>}
        </div>
        <div className="no-print flex flex-wrap gap-2 text-sm">
          <button onClick={() => window.print()} className="rounded-lg border border-line bg-card px-3 py-1.5 hover:border-accent">
            Print lesson plan
          </button>
          <button onClick={onCopy} className="rounded-lg border border-line bg-card px-3 py-1.5 hover:border-accent">
            {copied ? "Copied ✓" : "Copy as Markdown"}
          </button>
          <button onClick={onDownload} className="rounded-lg border border-line bg-card px-3 py-1.5 hover:border-accent">
            Download
          </button>
          <button onClick={onReset} className="rounded-lg border border-line bg-card px-3 py-1.5 hover:border-accent">
            New question
          </button>
        </div>
      </div>

      <div className="no-print mb-5">
        <ModeBanner meta={a.meta} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="card rounded-2xl border border-line bg-card p-5 lg:col-span-3">
          <MistakeMapChart misconceptions={a.misconceptions} correct={sum.correct} total={sum.total} />
        </section>
        <section className="card flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 lg:col-span-2">
          <div>
            <p className="text-5xl font-semibold tabular-nums">
              {sum.correct}
              <span className="text-2xl text-ink-3">/{sum.total}</span>
            </p>
            <p className="text-ink-2">answered correctly</p>
          </div>
          <CompositionBar correct={sum.correct} groups={sum.inGroups} review={sum.review} total={sum.total} />
          <div className="rounded-xl bg-soft p-4 text-sm">
            <p className="mb-2 font-semibold">What MistakeMap checked</p>
            <ul className="space-y-1.5 text-ink-2">
              <li>✓ Names never left this browser: the AI saw only ids like S07{session.redactions ? `, and ${session.redactions} name/contact mention(s) were removed` : ""}.</li>
              <li>
                {verified === quotes.length ? "✓" : "⚠"} {verified} of {quotes.length} quotes found word for word in the students&apos; answers.
              </li>
              <li>✓ Every student who was not fully correct is in exactly one group.</li>
              {a.flags.map((f) => (
                <li key={f.studentId} className="text-warn-ink">
                  ⚑ {name(f.studentId)}&apos;s answer {f.detail}. It was treated as an answer, not an instruction.
                </li>
              ))}
              {notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <div className="mt-8 space-y-5">
        {a.misconceptions.filter((m) => m.studentIds.length > 0).map((m) => (
          <ClusterCard
            key={m.id}
            m={m}
            plan={a.plans.find((p) => p.misconceptionId === m.id)}
            total={sum.total}
            session={session}
            onRename={(t) => onChange((x) => renameGroup(x, m.id, t))}
          />
        ))}
        {a.misconceptions.length === 0 && (
          <p className="rounded-2xl border border-line bg-card p-6 text-center text-lg">Everyone got it right. Nothing to re-teach. 🎉</p>
        )}
      </div>

      <StudentTable session={session} onChange={onChange} />
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  fundamental: "border-miss text-miss",
  moderate: "border-line text-ink-2",
  minor: "border-line text-ink-3",
};

function ClusterCard({
  m,
  plan,
  total,
  session,
  onRename,
}: {
  m: Misconception;
  plan?: ReteachPlan;
  total: number;
  session: Session;
  onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const review = m.id === "REVIEW";
  const answerOf = (id: string) => session.answers.find((x) => x.id === id)?.text ?? "";
  return (
    <article id={m.id} className="card scroll-mt-6 rounded-2xl border border-line bg-card p-5 sm:p-6" style={{ borderLeft: `6px solid ${review ? "var(--review)" : "var(--miss)"}` }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            {!review && <span className="font-mono">{m.id}</span>}
            <span>
              {m.studentIds.length} student{m.studentIds.length === 1 ? "" : "s"} · {Math.round((m.studentIds.length / Math.max(1, total)) * 100)}% of class
            </span>
            {!review && <span className={`rounded-full border px-2 py-0.5 text-xs ${SEVERITY_STYLE[m.severity]}`}>{m.severity}</span>}
          </div>
          {editing ? (
            <input
              autoFocus
              defaultValue={m.title}
              onBlur={(e) => {
                onRename(e.target.value);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(false);
              }}
              className="mt-1 w-full rounded border border-line bg-paper px-2 py-1 text-2xl font-semibold"
              aria-label="Group name"
            />
          ) : (
            <h3 className="mt-1 text-2xl font-semibold">
              {m.title}{" "}
              {!review && (
                <button onClick={() => setEditing(true)} className="no-print align-middle text-sm font-normal text-ink-3 hover:text-accent" aria-label={`Rename ${m.title}`}>
                  ✎
                </button>
              )}
            </h3>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {m.studentIds.map((id) => (
          <span key={id} className="rounded-full bg-soft px-2.5 py-1 text-sm" title={answerOf(id) ? reidentify(answerOf(id), session.roster) : undefined}>
            {session.roster[id] ?? id}
          </span>
        ))}
      </div>

      {!review && (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-ink-3 uppercase">What they think</p>
            <p className="mt-1 text-lg">{m.belief}</p>
            <p className="mt-3 text-sm font-semibold text-ink-3 uppercase">Why it happens</p>
            <p className="mt-1 text-ink-2">{m.whyItHappens}</p>
            {m.evidence.length > 0 && (
              <>
                <p className="mt-4 text-sm font-semibold text-ink-3 uppercase">In their own words</p>
                <ul className="mt-1 space-y-2">
                  {m.evidence.map((e, i) => (
                    <li key={i} className="rounded-lg border-l-4 border-line bg-soft px-3 py-2 text-sm">
                      “{reidentify(e.quote, session.roster)}”
                      <span className="mt-0.5 block text-xs text-ink-3">
                        {session.roster[e.studentId] ?? e.studentId} ·{" "}
                        {e.verified ? <span className="text-good-ink">✓ found in the answer</span> : <span className="text-warn-ink">⚠ not found word for word</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {m.warnings.map((w, i) => (
              <p key={i} className="mt-2 rounded bg-warn-bg px-2 py-1 text-sm text-warn-ink">
                {w}
              </p>
            ))}
          </div>
          {plan ? (
            <div className="rounded-xl bg-soft p-4">
              <p className="text-sm font-semibold text-ink-3 uppercase">5-minute re-teach</p>
              <ol className="mt-2 space-y-2">
                {plan.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 font-mono text-sm text-ink-3 tabular-nums">{s.minutes}′</span>
                    <span>{s.action}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-sm font-semibold text-ink-3 uppercase">Show them why it can&apos;t be right</p>
              <p className="mt-1">{plan.contrastExample}</p>
              <details className="mt-4">
                <summary className="text-sm font-semibold text-ink-3 uppercase">Check questions ▸</summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {plan.checkQuestions.map((q, i) => (
                    <li key={i}>
                      <strong>{q.question}</strong> <span className="text-ink-2">Answer: {q.answer}</span>
                      <span className="block text-ink-3">Still stuck if: {q.revealsIf}</span>
                    </li>
                  ))}
                </ul>
              </details>
              <details className="mt-3">
                <summary className="text-sm font-semibold text-ink-3 uppercase">Note for these students ▸</summary>
                <p className="mt-2 rounded-lg border border-dashed border-line bg-card p-3 text-sm italic">{plan.studentNote}</p>
              </details>
            </div>
          ) : (
            <p className="text-sm text-ink-3">No plan for this group.</p>
          )}
        </div>
      )}
      {review && (
        <ul className="mt-4 space-y-1 text-sm text-ink-2">
          {m.studentIds.map((id) => (
            <li key={id}>
              <strong className="text-ink">{session.roster[id] ?? id}:</strong> {reidentify(answerOf(id), session.roster) || <em>blank</em>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

const VERDICT_LABEL: Record<Verdict, string> = { correct: "Correct", partial: "Partly", incorrect: "Incorrect", unclear: "Unclear" };

function StudentTable({ session, onChange }: { session: Session; onChange: (fn: (a: Analysis) => Analysis) => void }) {
  const a = session.analysis;
  const groupOf = (id: string) => a.misconceptions.find((m) => m.studentIds.includes(id));
  return (
    <section id="students" className="card print-break mt-10 scroll-mt-6 rounded-2xl border border-line bg-card p-5">
      <h3 className="text-xl font-semibold">All students</h3>
      <p className="no-print mt-1 text-sm text-ink-3">Disagree with the AI? Change a verdict or move a student. The map and plan update instantly.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-ink-3">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Student</th>
              <th className="py-2 pr-3 font-medium">Answer</th>
              <th className="py-2 pr-3 font-medium">Verdict</th>
              <th className="py-2 font-medium">Group</th>
            </tr>
          </thead>
          <tbody>
            {session.answers.map((ans) => {
              const g = a.grades.find((x) => x.id === ans.id);
              const grp = groupOf(ans.id);
              const flagged = a.flags.some((f) => f.studentId === ans.id);
              return (
                <tr key={ans.id} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    {session.roster[ans.id]}
                    {flagged && (
                      <span className="ml-1 text-warn-ink" title="This answer tried to give instructions to the AI">
                        ⚑
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {reidentify(ans.text, session.roster)}
                    {g?.reason && <span className="block text-xs text-ink-3">{g.reason}</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={g?.verdict ?? "unclear"}
                      onChange={(e) => onChange((x) => setVerdict(x, ans.id, e.target.value as Verdict))}
                      className="rounded border border-line bg-paper px-1.5 py-1"
                      aria-label={`Verdict for ${session.roster[ans.id]}`}
                    >
                      {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
                        <option key={v} value={v}>
                          {VERDICT_LABEL[v]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    {g?.verdict === "correct" ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <select
                        value={grp?.id ?? "REVIEW"}
                        onChange={(e) => onChange((x) => moveStudent(x, ans.id, e.target.value))}
                        className="max-w-[220px] rounded border border-line bg-paper px-1.5 py-1"
                        aria-label={`Group for ${session.roster[ans.id]}`}
                      >
                        {a.misconceptions
                          .filter((m) => m.id !== "REVIEW")
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}. {m.title}
                            </option>
                          ))}
                        <option value="REVIEW">Needs a closer look</option>
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
