import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extname } from 'path';
import {
  ParsedDocument,
  RemoteParseResponse,
} from './document-intelligence.types';

@Injectable()
export class DocumentParserService {
  private readonly geminiClient: GoogleGenerativeAI | null;
  private readonly geminiModel: string;

  constructor(private readonly config: ConfigService) {
    const key =
      this.config.get<string>('GEMINI_API_KEY') ||
      this.config.get<string>('GOOGLE_API_KEY');
    this.geminiClient = key ? new GoogleGenerativeAI(key) : null;
    this.geminiModel =
      this.config.get<string>('GEMINI_OCR_MODEL') ||
      this.config.get<string>('GEMINI_MODEL') ||
      'gemini-flash-latest';
  }

  getStatus() {
    const provider = (
      this.config.get<string>('DOCUMENT_PARSER_PROVIDER') ?? 'auto'
    ).toLowerCase();
    return {
      provider,
      ready:
        provider === 'gemini'
          ? this.geminiClient !== null
          : provider === 'docling'
            ? Boolean(this.config.get<string>('DOCUMENT_INTELLIGENCE_URL'))
            : Boolean(
                this.config.get<string>('DOCUMENT_INTELLIGENCE_URL') ||
                this.geminiClient,
              ),
      model: provider === 'gemini' ? this.geminiModel : null,
    };
  }

  async parse(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<ParsedDocument> {
    const extension = extname(fileName).toLowerCase();
    if (extension === '.csv' || mimeType === 'text/csv') {
      const text = buffer.toString('utf8');
      return this.singleBlock(text, 'native-csv', false, true);
    }

    const provider = (
      this.config.get<string>('DOCUMENT_PARSER_PROVIDER') ?? 'auto'
    ).toLowerCase();
    const endpoint = this.config.get<string>('DOCUMENT_INTELLIGENCE_URL');
    if (provider === 'gemini')
      return this.parseWithGemini(buffer, fileName, mimeType);
    if (provider === 'docling') {
      if (!endpoint) {
        throw new ServiceUnavailableException(
          'DOCUMENT_PARSER_PROVIDER=docling memerlukan DOCUMENT_INTELLIGENCE_URL.',
        );
      }
      return this.parseRemotely(endpoint, buffer, fileName, mimeType);
    }
    if (provider !== 'auto') {
      throw new ServiceUnavailableException(
        'DOCUMENT_PARSER_PROVIDER harus auto, gemini, atau docling.',
      );
    }
    if (endpoint)
      return this.parseRemotely(endpoint, buffer, fileName, mimeType);
    if (this.geminiClient)
      return this.parseWithGemini(buffer, fileName, mimeType);

    if (extension === '.pdf' || mimeType === 'application/pdf') {
      return this.parseSimplePdf(buffer);
    }

    throw new ServiceUnavailableException(
      'Format ini memerlukan Docling/PaddleOCR. Konfigurasikan DOCUMENT_INTELLIGENCE_URL.',
    );
  }

  private async parseWithGemini(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<ParsedDocument> {
    if (!this.geminiClient) {
      throw new ServiceUnavailableException(
        'Gemini OCR belum dikonfigurasi. Isi GEMINI_API_KEY atau GOOGLE_API_KEY.',
      );
    }

    const model = this.geminiClient.getGenerativeModel({
      model: this.geminiModel,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            pages: { type: 'integer' },
            hasTextLayer: { type: 'boolean' },
            usedOcr: { type: 'boolean' },
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  pageNumber: { type: 'integer' },
                },
                required: ['text', 'pageNumber'],
              },
            },
          },
          required: ['text', 'pages', 'hasTextLayer', 'usedOcr', 'blocks'],
        } as never,
        maxOutputTokens: 8192,
        temperature: 0,
      },
    });

    const prompt = [
      `Ekstrak seluruh teks dari dokumen bernama ${JSON.stringify(fileName)}.`,
      'Pertahankan angka, kode, tanggal, nama pihak, alamat, tabel, satuan, dan nomor referensi secara akurat.',
      'Jangan menerjemahkan, meringkas, memperbaiki, atau mengarang isi yang tidak terlihat.',
      'Gabungkan seluruh teks ke field text dan pecah menjadi blocks berurutan dengan nomor halaman mulai dari 1.',
      'Untuk gambar tunggal gunakan pages=1. hasTextLayer hanya true bila PDF memiliki teks digital; usedOcr true bila pembacaan visual diperlukan.',
    ].join(' ');

    try {
      const result = await model.generateContent([
        {
          inlineData: {
            data: buffer.toString('base64'),
            mimeType,
          },
        },
        { text: prompt },
      ]);
      const parsed = JSON.parse(
        this.stripCodeFence(result.response.text()),
      ) as {
        text?: unknown;
        pages?: unknown;
        hasTextLayer?: unknown;
        usedOcr?: unknown;
        blocks?: Array<{ text?: unknown; pageNumber?: unknown }>;
      };
      if (typeof parsed.text !== 'string') {
        throw new Error('respons tidak memiliki field text');
      }
      const pages =
        typeof parsed.pages === 'number' && parsed.pages > 0
          ? Math.floor(parsed.pages)
          : 1;
      const blocks = (parsed.blocks ?? [])
        .filter((block) => typeof block.text === 'string' && block.text.trim())
        .map((block) => ({
          text: String(block.text).trim(),
          pageNumber:
            typeof block.pageNumber === 'number' && block.pageNumber > 0
              ? Math.floor(block.pageNumber)
              : null,
          boundingBox: null,
        }));
      return {
        text: parsed.text.trim(),
        pages,
        hasTextLayer: parsed.hasTextLayer === true,
        usedOcr: parsed.usedOcr !== false,
        parser: `gemini-${this.geminiModel}`,
        blocks: blocks.length
          ? blocks
          : [
              {
                text: parsed.text.trim(),
                pageNumber: 1,
                boundingBox: null,
              },
            ],
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Gemini OCR gagal: ${reason}`);
    }
  }

  private async parseRemotely(
    endpoint: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<ParsedDocument> {
    const timeoutMs = Number(
      this.config.get<string>('DOCUMENT_INTELLIGENCE_TIMEOUT_MS') ?? 300_000,
    );
    let response: Response;
    try {
      response = await fetch(`${endpoint.replace(/\/$/, '')}/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file_name: fileName,
          mime_type: mimeType,
          content_base64: buffer.toString('base64'),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `timeout setelah ${timeoutMs} ms`
          : error instanceof Error
            ? error.message
            : 'network error';
      throw new ServiceUnavailableException(
        `Document parser tidak dapat dihubungi di ${endpoint}: ${reason}`,
      );
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new ServiceUnavailableException(
        `Document parser gagal (${response.status})${detail ? `: ${detail}` : ''}`,
      );
    }
    let result: RemoteParseResponse;
    try {
      result = (await response.json()) as RemoteParseResponse;
    } catch {
      throw new ServiceUnavailableException(
        'Document parser mengembalikan respons non-JSON. Periksa DOCUMENT_INTELLIGENCE_URL.',
      );
    }
    if (typeof result.text !== 'string') {
      throw new ServiceUnavailableException(
        'Document parser mengembalikan payload tanpa field text.',
      );
    }
    const blocks = (result.blocks ?? []).map((block) => ({
      text: block.text,
      pageNumber: block.page ?? null,
      boundingBox: block.bounding_box ?? null,
    }));
    return {
      text: result.text,
      pages: result.pages ?? 1,
      hasTextLayer: result.has_text_layer ?? !result.used_ocr,
      parser: result.parser ?? 'docling',
      usedOcr: result.used_ocr ?? false,
      blocks: blocks.length
        ? blocks
        : [{ text: result.text, pageNumber: 1, boundingBox: null }],
    };
  }

  /** Lightweight fallback for text PDFs. Production uses the remote Docling adapter. */
  private parseSimplePdf(buffer: Buffer): ParsedDocument {
    const source = buffer.toString('latin1');
    const pages = Math.max(
      1,
      (source.match(/\/Type\s*\/Page\b/g) ?? []).length,
    );
    const literalStrings = [
      ...source.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g),
    ]
      .map((match) => match[1])
      .map((value) =>
        value
          .replace(/\\([()\\])/g, '$1')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\n'),
      );
    const text = literalStrings.join(' ').trim();
    if (!text) {
      throw new ServiceUnavailableException(
        'PDF tidak memiliki text layer yang dapat dibaca fallback; OCR Docling/PaddleOCR diperlukan.',
      );
    }
    return this.singleBlock(
      text,
      'native-pdf-text-fallback',
      false,
      true,
      pages,
    );
  }

  private singleBlock(
    text: string,
    parser: string,
    usedOcr: boolean,
    hasTextLayer: boolean,
    pages = 1,
  ): ParsedDocument {
    return {
      text,
      pages,
      hasTextLayer,
      parser,
      usedOcr,
      blocks: [{ text, pageNumber: 1, boundingBox: null }],
    };
  }

  private stripCodeFence(value: string): string {
    return value
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }
}
