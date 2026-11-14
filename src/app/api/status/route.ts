import { MAX_ANSWERS } from "@/lib/api";
import { pickProvider } from "@/lib/llm";

export const dynamic = "force-dynamic";

export function GET() {
  const { llm } = pickProvider();
  return Response.json(
    { live: !!llm, provider: llm?.provider ?? "none", model: llm?.model ?? "demo", maxAnswers: MAX_ANSWERS },
    { headers: { "cache-control": "no-store" } },
  );
}
