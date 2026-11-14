import { z } from "zod";
import { LLMError, pickProvider } from "./llm";
import { allow, clientKey } from "./ratelimit";
import { AnswerSchema, GradeSchema, RawMisconceptionSchema, TaskSchema } from "./types";

export const MAX_ANSWERS = Number(process.env.MAX_ANSWERS || 60);
const PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 12);

export const BaseBody = z.object({
  task: TaskSchema,
  answers: z.array(AnswerSchema).min(1).max(MAX_ANSWERS),
});

export const MisconceptionInSchema = RawMisconceptionSchema.extend({
  id: z.string(),
  evidence: z.array(z.object({ studentId: z.string(), quote: z.string(), verified: z.boolean() })),
  warnings: z.array(z.string()),
});

export const GradeBody = BaseBody;
export const ClusterBody = BaseBody.extend({ grades: z.array(GradeSchema) });
export const PlanBody = BaseBody.extend({ misconceptions: z.array(MisconceptionInSchema).max(30) });

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Shared wrapper: parses the body, picks the provider, applies the rate limit to live calls
 * (only the first step of an analysis counts) and turns errors into readable messages.
 */
export async function handle<B>(
  req: Request,
  schema: z.ZodType<B>,
  run: (body: B, llm: ReturnType<typeof pickProvider>["llm"]) => Promise<unknown>,
  opts: { countsAsAnalysis?: boolean } = {},
) {
  let body: B;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "Invalid JSON";
    return json({ error: `Bad request. ${msg}` }, 400);
  }
  const { llm } = pickProvider();
  if (llm && opts.countsAsAnalysis && !allow(clientKey(req), PER_HOUR)) {
    return json({ error: "This public demo allows a few live analyses per hour. Try a sample class, or run it locally with your own key." }, 429);
  }
  try {
    return json(await run(body, llm));
  } catch (e) {
    if (e instanceof LLMError) {
      console.error("[mistakemap] LLM error:", e.message);
      return json({ error: e.userMessage }, 502);
    }
    console.error("[mistakemap] unexpected error:", e);
    return json({ error: "Something went wrong on the server." }, 500);
  }
}
