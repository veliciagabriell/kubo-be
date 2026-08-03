import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import {
  ParsedDocument,
  RemoteParseResponse,
} from './document-intelligence.types';

@Injectable()
export class DocumentParserService {
  constructor(private readonly config: ConfigService) {}

  async parse(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<ParsedDocument> {
    const endpoint = this.config.get<string>('DOCUMENT_INTELLIGENCE_URL');
    if (endpoint)
      return this.parseRemotely(endpoint, buffer, fileName, mimeType);

    const extension = extname(fileName).toLowerCase();
    if (extension === '.csv' || mimeType === 'text/csv') {
      const text = buffer.toString('utf8');
      return this.singleBlock(text, 'native-csv', false, true);
    }

    if (extension === '.pdf' || mimeType === 'application/pdf') {
      return this.parseSimplePdf(buffer);
    }

    throw new ServiceUnavailableException(
      'Format ini memerlukan Docling/PaddleOCR. Konfigurasikan DOCUMENT_INTELLIGENCE_URL.',
    );
  }

  private async parseRemotely(
    endpoint: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<ParsedDocument> {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file_name: fileName,
        mime_type: mimeType,
        content_base64: buffer.toString('base64'),
      }),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Document parser gagal (${response.status})`,
      );
    }
    const result = (await response.json()) as RemoteParseResponse;
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
}
