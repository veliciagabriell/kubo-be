import { Injectable } from '@nestjs/common';
import {
  ClassificationResult,
  ExtractedValue,
  ParsedBlock,
  ParsedDocument,
} from './document-intelligence.types';
import { DocumentType } from './entities/document.entity';

interface FieldRule {
  field: string;
  patterns: RegExp[];
  unit?: string;
}

const FIELD_RULES: FieldRule[] = [
  {
    field: 'invoice_number',
    patterns: [/invoice\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n,;]+)/i],
  },
  {
    field: 'invoice_date',
    patterns: [/invoice\s*date\s*[:#-]?\s*([^\n,;]+)/i],
  },
  {
    field: 'gross_weight',
    unit: 'kg',
    patterns: [
      /(?:total\s+)?gross\s+weight\s*[:#-]?\s*([\d.,]+)\s*(?:kg|kgs|kilograms?)?/i,
    ],
  },
  {
    field: 'net_weight',
    unit: 'kg',
    patterns: [
      /(?:total\s+)?net\s+weight\s*[:#-]?\s*([\d.,]+)\s*(?:kg|kgs|kilograms?)?/i,
    ],
  },
  {
    field: 'package_count',
    patterns: [/(?:total\s+)?(?:packages?|pkgs?)\s*[:#-]?\s*(\d+)/i],
  },
  {
    field: 'cbm',
    unit: 'm3',
    patterns: [
      /(?:total\s+)?(?:cbm|volume)\s*[:#-]?\s*([\d.,]+)\s*(?:m3|m³|cbm)?/i,
    ],
  },
  {
    field: 'hs_code',
    patterns: [
      /(?:hs\s*(?:code|tariff(?:\s+classification)?))\s*[:#-]?\s*([\d.]{6,12})/i,
    ],
  },
  {
    field: 'currency',
    patterns: [
      /(?:currency)\s*[:#-]?\s*([A-Z]{3})/i,
      /\b(USD|IDR|EUR|JPY|SGD|AUD)\b/,
    ],
  },
  {
    field: 'total_price',
    patterns: [
      /(?:total\s+(?:amount|price|value)|grand\s+total)\s*[:#-]?\s*(?:[A-Z]{3}\s*)?([\d.,]+)/i,
    ],
  },
  {
    field: 'quantity',
    patterns: [/(?:quantity|qty)\s*[:#-]?\s*([\d.,]+)\s*([A-Za-z]+)/i],
  },
  {
    field: 'origin_country',
    patterns: [
      /(?:country\s+of\s+origin|origin\s+country)\s*[:#-]?\s*([^\n,;]+)/i,
    ],
  },
  {
    field: 'destination_country',
    patterns: [
      /(?:ultimate\s+destination|destination\s+country)\s*[:#-]?\s*([^\n,;]+)/i,
    ],
  },
  {
    field: 'port_of_loading',
    patterns: [/port\s+of\s+loading\s*[:#-]?\s*([^\n,;]+)/i],
  },
  {
    field: 'port_of_discharge',
    patterns: [/port\s+of\s+discharge\s*[:#-]?\s*([^\n,;]+)/i],
  },
];

@Injectable()
export class DocumentExtractorService {
  classify(
    fileName: string,
    text: string,
    declaredType?: DocumentType | null,
  ): ClassificationResult {
    const haystack =
      `${fileName.replace(/[_-]+/g, ' ')}\n${text}`.toLowerCase();
    const scores = new Map<DocumentType, number>([
      [
        DocumentType.COMMERCIAL_INVOICE,
        this.score(haystack, [
          'commercial invoice',
          'invoice number',
          'total amount',
          'unit price',
        ]),
      ],
      [
        DocumentType.PACKING_LIST,
        this.score(haystack, [
          'packing list',
          'gross weight',
          'net weight',
          'package',
        ]),
      ],
      [
        DocumentType.CERTIFICATE_OF_ORIGIN,
        this.score(haystack, [
          'certificate of origin',
          'country of origin',
          'origin criterion',
        ]),
      ],
      [
        DocumentType.BILL_OF_LADING,
        this.score(haystack, [
          'bill of lading',
          'port of loading',
          'port of discharge',
          'carrier',
        ]),
      ],
    ]);
    if (declaredType)
      scores.set(declaredType, (scores.get(declaredType) ?? 0) + 2);
    const [type, score] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
    if (score === 0)
      return {
        type: declaredType ?? null,
        confidence: declaredType ? 0.55 : 0,
        method: declaredType ? 'user_declared' : 'rules',
      };
    return {
      type,
      confidence: Math.min(0.98, 0.5 + score * 0.08),
      method: declaredType
        ? 'user_declared_and_rules'
        : 'filename_keyword_structure_rules',
    };
  }

  extract(parsed: ParsedDocument): ExtractedValue[] {
    const results: ExtractedValue[] = [];
    for (const rule of FIELD_RULES) {
      const found = this.find(rule, parsed.blocks);
      if (found) results.push(found);
    }
    return results;
  }

  private find(rule: FieldRule, blocks: ParsedBlock[]): ExtractedValue | null {
    for (const block of blocks) {
      for (const pattern of rule.patterns) {
        const match = pattern.exec(block.text);
        if (!match?.[1]) continue;
        const value = match[1].trim().replace(/\s+/g, ' ');
        return {
          field: rule.field,
          value,
          unit:
            rule.unit ??
            (rule.field === 'quantity'
              ? (match[2]?.toLowerCase() ?? null)
              : null),
          confidence: 0.9,
          source: { ...block, text: match[0] },
          method: 'regex_deterministic',
        };
      }
    }
    return null;
  }

  private score(text: string, keywords: string[]): number {
    return keywords.reduce(
      (total, keyword) => total + (text.includes(keyword) ? 1 : 0),
      0,
    );
  }
}
