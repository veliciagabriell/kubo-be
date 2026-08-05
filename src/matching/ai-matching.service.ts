import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Only real data goes into this candidate - no fabricated product/cargo
 * fields. Fields we don't actually have (e.g. product category, fragility)
 * are simply omitted rather than guessed, and the prompt tells the model
 * not to assume anything not present here.
 */
export interface AiMatchCandidate {
  containerId: string;
  destinationCity: string;
  vesselName: string | null;
  vesselType: string | null;
  departureDate: string;
  occupancyPercent: number;
  remainingCbm: number;
  requestedCbm: number;
  fullnessPercent: number | null;
  mcdaScore: number;
}

export interface AiMatchResult {
  containerId: string;
  aiScore: number;
  rationale: string;
}

export type AiProvider = 'gemini' | 'claude' | null;

// 'gemini-2.0-flash' returns a real free-tier quota of 0 on many keys/regions
// ('models/gemini-2.5-flash' similarly errors "no longer available to new
// users") - 'gemini-flash-latest' is the alias Google keeps pointed at
// whichever current model actually has free-tier access, confirmed working
// against a real key during testing.
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';
const MAX_OUTPUT_TOKENS = 2048;

const SYSTEM_PROMPT =
  'Anda adalah asisten AI untuk KUBO, platform ekspor UMKM Indonesia ke Jepang via ' +
  'Consolidated LCL. Tugas: menilai kecocokan kualitatif setiap kandidat slot container ' +
  '(di kapal nyata yang terlacak via AIS) untuk kebutuhan pengiriman user, MELENGKAPI ' +
  '(bukan menggantikan) skor kuantitatif MCDA yang sudah dihitung. Pertimbangkan hal-hal ' +
  'yang tidak tertangkap rumus numerik: jenis/tipe kapal vs kebutuhan umum ekspor furnitur ' +
  'UMKM, tingkat kepenuhan kapal, dan kewajaran jadwal. PENTING: hanya gunakan data yang ' +
  'diberikan di pesan user - jangan mengarang atau mengasumsikan data yang tidak ada (mis. ' +
  'jangan asumsikan kategori produk tertentu jika tidak disebutkan). Balas HANYA dengan JSON ' +
  'valid berbentuk {"matches":[{"containerId":string,"compatibilityScore":number 0-1,' +
  '"rationale":string singkat 1-2 kalimat Bahasa Indonesia}]} - tanpa markdown, tanpa teks lain.';

/** Claude's json_schema structured output requires `additionalProperties: false` on every object. */
const CLAUDE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          containerId: { type: 'string' },
          compatibilityScore: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['containerId', 'compatibilityScore', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
};

/** Gemini's responseSchema is a restricted OpenAPI-3.0 subset - it rejects `additionalProperties`. */
const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          containerId: { type: 'string' },
          compatibilityScore: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['containerId', 'compatibilityScore', 'rationale'],
      },
    },
  },
  required: ['matches'],
};

interface ParsedMatches {
  matches: { containerId: string; compatibilityScore: number; rationale: string }[];
}

function toAiMatchResults(parsed: ParsedMatches): AiMatchResult[] {
  return parsed.matches.map((m) => ({
    containerId: m.containerId,
    aiScore: Math.max(0, Math.min(1, m.compatibilityScore)),
    rationale: m.rationale,
  }));
}

/** Strips a ```json ... ``` fence if the model wrapped its JSON in one despite instructions. */
function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/**
 * AI re-ranking/explanation layer for Smart Container Matching. Mirrors the
 * AIS graceful-degrade pattern: if no provider key is configured, `enabled`
 * is false and callers fall back to the real-data MCDA score - no crash, no
 * dummy fallback score.
 *
 * Provider selection (in priority order):
 * 1. GEMINI_API_KEY - Google Gemini free tier (aistudio.google.com/apikey,
 *    no credit card required). Preferred default since it costs nothing.
 * 2. ANTHROPIC_API_KEY - Claude, if you'd rather use it / already have a key.
 * 3. Neither set - AI layer disabled, MCDA-only.
 */
@Injectable()
export class AiMatchingService {
  private readonly logger = new Logger(AiMatchingService.name);
  private provider: AiProvider = null;
  private geminiClient: GoogleGenerativeAI | null = null;
  private readonly geminiModel: string;
  private claudeClient: Anthropic | null = null;
  private readonly claudeModel: string;

  constructor() {
    this.geminiModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    this.claudeModel = process.env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;

    const geminiKey = process.env.GEMINI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (geminiKey) {
      this.geminiClient = new GoogleGenerativeAI(geminiKey);
      this.provider = 'gemini';
      this.logger.log(
        `AI re-ranking layer for Smart Container Matching active via Google Gemini (${this.geminiModel}, free tier).`,
      );
    } else if (anthropicKey) {
      this.claudeClient = new Anthropic({ apiKey: anthropicKey });
      this.provider = 'claude';
      this.logger.log(`AI re-ranking layer for Smart Container Matching active via Claude (${this.claudeModel}).`);
    } else {
      this.logger.warn(
        'No AI provider configured (GEMINI_API_KEY or ANTHROPIC_API_KEY) - AI re-ranking layer ' +
          'disabled, matching falls back to the real-data MCDA score only. Get a free Gemini key ' +
          '(no credit card) at https://aistudio.google.com/apikey to enable it at no cost.',
      );
    }
  }

  get enabled(): boolean {
    return this.provider != null;
  }

  get activeProvider(): AiProvider {
    return this.provider;
  }

  get activeModel(): string | null {
    if (this.provider === 'gemini') return this.geminiModel;
    if (this.provider === 'claude') return this.claudeModel;
    return null;
  }

  async scoreCandidates(
    candidates: AiMatchCandidate[],
    cargoContext: { volumeCbm: number; preferredDate: string },
  ): Promise<AiMatchResult[] | null> {
    if (!this.provider || candidates.length === 0) return null;
    try {
      if (this.provider === 'gemini') return await this.scoreCandidatesGemini(candidates, cargoContext);
      return await this.scoreCandidatesClaude(candidates, cargoContext);
    } catch (err) {
      this.logger.error(
        `AI re-ranking call failed (provider=${this.provider}), falling back to MCDA-only score: ${err}`,
      );
      return null;
    }
  }

  private async scoreCandidatesGemini(
    candidates: AiMatchCandidate[],
    cargoContext: { volumeCbm: number; preferredDate: string },
  ): Promise<AiMatchResult[] | null> {
    const model = this.geminiClient!.getGenerativeModel({
      model: this.geminiModel,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA as never,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });
    const result = await model.generateContent(JSON.stringify({ cargo: cargoContext, candidates }));
    const raw = result.response.text();
    const parsed = JSON.parse(stripCodeFence(raw)) as ParsedMatches;
    return toAiMatchResults(parsed);
  }

  private async scoreCandidatesClaude(
    candidates: AiMatchCandidate[],
    cargoContext: { volumeCbm: number; preferredDate: string },
  ): Promise<AiMatchResult[] | null> {
    const response = await this.claudeClient!.messages.create({
      model: this.claudeModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({ cargo: cargoContext, candidates }) }],
      output_config: {
        format: { type: 'json_schema', schema: CLAUDE_RESPONSE_JSON_SCHEMA },
      },
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;
    const parsed = JSON.parse(textBlock.text) as ParsedMatches;
    return toAiMatchResults(parsed);
  }
}
