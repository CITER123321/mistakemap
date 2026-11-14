import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string; // base64, no data: prefix
}

export interface JsonRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  images?: ImageInput[];
}

export interface LLM {
  provider: "anthropic" | "gemini";
  model: string;
  json<T>(req: JsonRequest<T>): Promise<T>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}

export function anthropicLLM(apiKey: string, model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5"): LLM {
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });
  return {
    provider: "anthropic",
    model,
    async json<T>(req: JsonRequest<T>): Promise<T> {
      const content: Anthropic.ContentBlockParam[] = [
        ...(req.images ?? []).map(
          (img): Anthropic.ImageBlockParam => ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.data },
          }),
        ),
        { type: "text", text: req.prompt },
      ];
      try {
        const res = await client.messages.parse({
          model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: "user", content }],
          output_config: { effort: "medium", format: zodOutputFormat(req.schema as z.ZodType<T>) },
        });
        if (res.stop_reason === "refusal") {
          throw new LLMError("refusal", "The model declined this request. Try rephrasing the question, or use offline mode.");
        }
        if (res.stop_reason === "max_tokens") {
          throw new LLMError("max_tokens", "The class is too large for one pass. Try fewer answers.");
        }
        if (res.parsed_output == null) throw new LLMError("no parsed output", "The model returned an unexpected format. Try again.");
        return res.parsed_output as T;
      } catch (err) {
        if (err instanceof LLMError) throw err;
        if (err instanceof Anthropic.AuthenticationError) throw new LLMError(err.message, "The Anthropic API key is not valid.");
        if (err instanceof Anthropic.RateLimitError) throw new LLMError(err.message, "The AI provider is rate limiting us. Wait a minute and try again.");
        if (err instanceof Anthropic.APIError) throw new LLMError(err.message, `The AI provider returned an error (${err.status ?? "network"}).`);
        throw err;
      }
    },
  };
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(t);
}

export function geminiLLM(apiKey: string, model = process.env.GEMINI_MODEL || "gemini-flash-latest", fetchImpl: typeof fetch = fetch): LLM {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    provider: "gemini",
    model,
    async json<T>(req: JsonRequest<T>): Promise<T> {
      const jsonSchema = z.toJSONSchema(req.schema as z.ZodType);
      const prompt = `${req.prompt}\n\nReturn only JSON that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
      const parts = [
        ...(req.images ?? []).map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.data } })),
        { text: prompt },
      ];
      const call = async (withSchema: boolean) => {
        const body = {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            ...(withSchema ? { responseJsonSchema: jsonSchema } : {}),
          },
        };
        return fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
      };

      let lastError = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        let res = await call(attempt === 0);
        if (res.status === 400 && attempt === 0) res = await call(false); // older models reject responseJsonSchema
        if (res.status === 401 || res.status === 403) throw new LLMError(`gemini ${res.status}`, "The Gemini API key is not valid.");
        if (res.status === 429) throw new LLMError("gemini 429", "Gemini's free tier is rate limiting us. Wait a minute and try again.");
        if (!res.ok) throw new LLMError(`gemini ${res.status}: ${await res.text()}`, `The AI provider returned an error (${res.status}).`);
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
          promptFeedback?: { blockReason?: string };
        };
        if (data.promptFeedback?.blockReason) throw new LLMError("blocked", "The model declined this request.");
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        try {
          return req.schema.parse(extractJson(text));
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      throw new LLMError(`gemini bad json: ${lastError}`, "The model returned an unexpected format. Try again.");
    },
  };
}

export type ProviderChoice = { llm: LLM | null; reason: string };

/** Picks a provider from the environment. No key means demo/offline mode. */
export function pickProvider(env: Record<string, string | undefined> = process.env): ProviderChoice {
  const forced = (env.AI_PROVIDER || "").toLowerCase();
  if (forced === "demo") return { llm: null, reason: "AI_PROVIDER=demo" };
  const a = env.ANTHROPIC_API_KEY?.trim();
  const g = env.GEMINI_API_KEY?.trim();
  if ((forced === "anthropic" || !forced) && a) return { llm: anthropicLLM(a, env.ANTHROPIC_MODEL || undefined), reason: "ANTHROPIC_API_KEY" };
  if ((forced === "gemini" || !forced) && g) return { llm: geminiLLM(g, env.GEMINI_MODEL || undefined), reason: "GEMINI_API_KEY" };
  if (forced === "gemini" && a) return { llm: anthropicLLM(a, env.ANTHROPIC_MODEL || undefined), reason: "fallback to ANTHROPIC_API_KEY" };
  if (forced === "anthropic" && g) return { llm: geminiLLM(g, env.GEMINI_MODEL || undefined), reason: "fallback to GEMINI_API_KEY" };
  return { llm: null, reason: "no API key" };
}
