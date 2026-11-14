import { z } from "zod";
import { handle, json } from "@/lib/api";
import { pickProvider } from "@/lib/llm";
import { SYSTEM_BASE, TRANSCRIBE_PROMPT } from "@/lib/prompts";

export const maxDuration = 300;

const Body = z.object({
  images: z
    .array(
      z.object({
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
        data: z.string().max(5_500_000),
      }),
    )
    .min(1)
    .max(6),
});

const Result = z.object({ sheets: z.array(z.object({ label: z.string(), text: z.string() })) });

export function POST(req: Request) {
  if (!pickProvider().llm) {
    return json({ error: "Reading photos needs live AI. Add an API key (see README), or type the answers in." }, 400);
  }
  return handle(
    req,
    Body,
    async (b, llm) => {
      const out = await llm!.json({ system: SYSTEM_BASE, prompt: TRANSCRIBE_PROMPT, schema: Result, images: b.images });
      return { sheets: out.sheets.slice(0, 80) };
    },
    { countsAsAnalysis: true },
  );
}
