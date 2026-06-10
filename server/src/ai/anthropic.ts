import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { AIError, type AIBackend } from "./backend.js";
import {
  CorrectiveSchema,
  DedupeResultSchema,
  DistractorsSchema,
  ExtractionResultSchema,
  GeneratedProbeSchema,
  GradeSchema,
  SweepDiffSchema,
} from "../types.js";
import { ingestionPrompt } from "../prompts/ingestion.js";
import { distractorsPrompt } from "../prompts/distractors.js";
import { dedupePrompt } from "../prompts/dedupe.js";
import {
  contrastProbePrompt,
  cuedProbePrompt,
  explainProbePrompt,
  recognitionProbePrompt,
  typedProbePrompt,
} from "../prompts/probe.js";
import { sweepDiffPrompt } from "../prompts/sweepDiff.js";
import { gradingPrompt } from "../prompts/grading.js";
import { correctivePrompt } from "../prompts/corrective.js";

const MODEL = "claude-haiku-4-5-20251001";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } };

const IMAGE_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export class AnthropicBackend implements AIBackend {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async validateKey(): Promise<void> {
    try {
      await this.client.messages.create({
        model: MODEL,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with OK" }],
      });
    } catch (err: any) {
      if (err?.status === 401) throw new AIError("That API key was rejected by Anthropic.");
      throw new AIError("Could not reach Anthropic to validate the key. Check your connection.");
    }
  }

  /**
   * Single chokepoint for all AI calls: send prompt, parse JSON, validate
   * with Zod. On a parse/validation failure, retry once with a corrective
   * message; after that, surface a clean user-facing error.
   */
  private async completeJSON<T>(
    schema: z.ZodType<T>,
    prompt: string,
    maxTokens: number,
    extraContent: ContentBlock[] = []
  ): Promise<T> {
    const content: ContentBlock[] = [...extraContent, { type: "text", text: prompt }];
    let lastRaw = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: Anthropic.MessageParam[] =
        attempt === 0
          ? [{ role: "user", content }]
          : [
              { role: "user", content },
              { role: "assistant", content: lastRaw || "(empty)" },
              {
                role: "user",
                content:
                  "That response was not valid JSON matching the required shape. Respond again with ONLY the JSON object, no prose, no code fences.",
              },
            ];
      let resp: Anthropic.Message;
      try {
        resp = await this.client.messages.create({ model: MODEL, max_tokens: maxTokens, messages });
      } catch (err: any) {
        if (err?.status === 401) throw new AIError("Your API key was rejected. Update it from the footer link.");
        if (err?.status === 429) throw new AIError("Anthropic rate limit hit — wait a moment and try again.");
        throw new AIError("The AI service is unreachable right now. Try again in a moment.");
      }
      lastRaw = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const parsed = tryParse(lastRaw);
      if (parsed !== undefined) {
        const result = schema.safeParse(parsed);
        if (result.success) return result.data;
      }
    }
    throw new AIError("The AI returned an unusable response twice. Please try again.");
  }

  async extract(material: string, images: { data: string; mediaType: string }[]) {
    const extra: ContentBlock[] = images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: IMAGE_TYPES.includes(img.mediaType as ImageMediaType)
          ? (img.mediaType as ImageMediaType)
          : "image/png",
        data: img.data,
      },
    }));
    return this.completeJSON(ExtractionResultSchema, ingestionPrompt(material, extra.length > 0), 8000, extra);
  }

  async distractors(statement: string, kind: string) {
    const r = await this.completeJSON(DistractorsSchema, distractorsPrompt(statement, kind), 600);
    return r.distractors;
  }

  async dedupe(candidates: string[], existing: string[]) {
    return this.completeJSON(DedupeResultSchema, dedupePrompt(candidates, existing), 2000);
  }

  async probe(
    modality: "mcq" | "cued" | "typed" | "explain" | "contrast",
    statement: string,
    contrastStatement: string | null,
    avoid: string[]
  ) {
    const prompt =
      modality === "mcq"
        ? recognitionProbePrompt(statement, avoid)
        : modality === "cued"
          ? cuedProbePrompt(statement, avoid)
          : modality === "typed"
            ? typedProbePrompt(statement, avoid)
            : modality === "explain"
              ? explainProbePrompt(statement, avoid)
              : contrastProbePrompt(statement, contrastStatement, avoid);
    return this.completeJSON(GeneratedProbeSchema, prompt, 500);
  }

  async sweepDiff(goalName: string, items: { id: string; statement: string }[], dump: string) {
    return this.completeJSON(SweepDiffSchema, sweepDiffPrompt(goalName, items, dump), 2500);
  }

  async grade(statement: string, question: string, answer: string) {
    return this.completeJSON(GradeSchema, gradingPrompt(statement, question, answer), 300);
  }

  async corrective(statement: string, question: string, learnerAnswer: string | null) {
    return this.completeJSON(CorrectiveSchema, correctivePrompt(statement, question, learnerAnswer), 400);
  }
}

function tryParse(raw: string): unknown | undefined {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  // Try direct parse, then the largest {...} slice.
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
