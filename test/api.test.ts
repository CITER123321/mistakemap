import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as grade } from "@/app/api/grade/route";
import { POST as cluster } from "@/app/api/cluster/route";
import { POST as plan } from "@/app/api/plan/route";
import { POST as transcribe } from "@/app/api/transcribe/route";
import { GET as status } from "@/app/api/status/route";
import { geminiLLM, pickProvider } from "@/lib/llm";
import { parseAnswers } from "@/lib/parse";
import { pseudonymise } from "@/lib/privacy";
import { SAMPLES } from "@/lib/samples";
import { GradeResultSchema } from "@/lib/types";

const post = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("API in demo mode (no keys)", () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");

  it("status reports demo mode", async () => {
    expect(await status().json()).toMatchObject({ live: false, provider: "none" });
  });

  it("runs the three steps for a sample", async () => {
    const s = SAMPLES[1];
    const { answers } = pseudonymise(parseAnswers(s.raw));
    const g = await (await grade(post({ task: s.task, answers }))).json();
    expect(g.meta.mode).toBe("demo-fixture");
    const c = await (await cluster(post({ task: s.task, answers, grades: g.grades }))).json();
    expect(c.misconceptions[0].title).toBe("Zero velocity means zero acceleration");
    const p = await (await plan(post({ task: s.task, answers, misconceptions: c.misconceptions }))).json();
    expect(p.plans).toHaveLength(4);
  });

  it("rejects bad input with a readable 400", async () => {
    const res = await grade(post({ task: { question: "" }, answers: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Bad request/);
  });

  it("rejects student ids that look like names", async () => {
    const res = await grade(post({ task: { question: "abc" }, answers: [{ id: "Ana", text: "x" }] }));
    expect(res.status).toBe(400);
  });

  it("photo transcription explains that it needs a key", async () => {
    const res = await transcribe(post({ images: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/API key/);
  });
});

describe("provider selection", () => {
  it("prefers Anthropic, honours AI_PROVIDER, and falls back to demo", () => {
    expect(pickProvider({}).llm).toBeNull();
    expect(pickProvider({ ANTHROPIC_API_KEY: "a" }).llm?.provider).toBe("anthropic");
    expect(pickProvider({ ANTHROPIC_API_KEY: "a" }).llm?.model).toBe("claude-opus-5-5");
    expect(pickProvider({ GEMINI_API_KEY: "g" }).llm?.provider).toBe("gemini");
    expect(pickProvider({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g", AI_PROVIDER: "gemini" }).llm?.provider).toBe("gemini");
    expect(pickProvider({ ANTHROPIC_API_KEY: "a", AI_PROVIDER: "demo" }).llm).toBeNull();
  });
});

describe("Gemini adapter", () => {
  afterEach(() => vi.restoreAllMocks());
  const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

  it("sends the key in a header, asks for JSON and validates the result", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok('```json\n{"grades":[{"id":"S01","verdict":"correct","confidence":0.9,"reason":"ok"}]}\n```'));
    const llm = geminiLLM("KEY", "gemini-test", fetchMock as unknown as typeof fetch);
    const out = await llm.json({ system: "sys", prompt: "p", schema: GradeResultSchema });
    expect(out.grades[0].verdict).toBe("correct");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("models/gemini-test:generateContent");
    expect(String(url)).not.toContain("KEY");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
    expect(JSON.parse(String(init!.body)).generationConfig.responseMimeType).toBe("application/json");
  });

  it("retries once on invalid JSON, then gives a friendly error", async () => {
    const fetchMock = vi.fn(async () => ok("not json"));
    const llm = geminiLLM("KEY", "m", fetchMock as unknown as typeof fetch);
    await expect(llm.json({ system: "", prompt: "", schema: GradeResultSchema })).rejects.toThrow(/bad json/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps 429 to a rate-limit message", async () => {
    const llm = geminiLLM("KEY", "m", (async () => new Response("", { status: 429 })) as unknown as typeof fetch);
    await expect(llm.json({ system: "", prompt: "", schema: GradeResultSchema })).rejects.toMatchObject({ userMessage: expect.stringMatching(/rate limiting/) });
  });
});
