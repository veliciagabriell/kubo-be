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

interface TextCandidate {
  text: string;
  source: ParsedBlock;
  sourceText: string | null;
}

interface MarkdownRow {
  cells: string[];
  sourceText: string;
}

const INVOICE_NUMBER: FieldRule = {
  field: 'invoice_number',
  patterns: [
    /(?:commercial\s+)?invoice\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const INVOICE_DATE: FieldRule = {
  field: 'invoice_date',
  patterns: [
    /(?:invoice\s*date|date\s+of\s+exportation)\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const GROSS_WEIGHT: FieldRule = {
  field: 'gross_weight',
  unit: 'kg',
  patterns: [
    /(?:total\s+)?gross\s+weight\s*[:#-]?\s*([\d.,]+)\s*(?:kg|kgs|kilograms?)?/i,
  ],
};

const NET_WEIGHT: FieldRule = {
  field: 'net_weight',
  unit: 'kg',
  patterns: [
    /(?:total\s+)?net(?:\s+weight)?\s*[:#-]?\s*([\d.,]+)\s*(?:kg|kgs|kilograms?)?/i,
  ],
};

const PACKAGE_COUNT: FieldRule = {
  field: 'package_count',
  patterns: [
    /(?:total\s+)?(?:number\s+of|no\.?\s+of)?\s*(?:packages?|pkgs?|package\s+qty)\s*[:#-]?\s*(\d+)/i,
  ],
};

const PACKAGE_TYPE: FieldRule = {
  field: 'package_type',
  patterns: [/(?:package\s+type|type\s+of\s+package)\s*[:#-]?\s*([^\n|]+)/i],
};

const CBM: FieldRule = {
  field: 'cbm',
  unit: 'm3',
  patterns: [
    /(?:total\s+)?(?:cbm|volume)\s*[:#-]?\s*([\d.,]+)\s*(?:m3|m³|cbm)?/i,
    /([\d.,]+)\s*(?:m3|m³|cbm)\b/i,
  ],
};

const HS_CODE: FieldRule = {
  field: 'hs_code',
  patterns: [
    /\bhs\s*(?:(?:code|tariff(?:\s+classification)?)(?:\s*\([^)]*\))?)?\s*[:#-]?\s*([\d.]{6,12})/i,
  ],
};

const CURRENCY: FieldRule = {
  field: 'currency',
  patterns: [
    /currency\s*[:#-]?\s*([A-Z]{3})/i,
    /\b(USD|IDR|EUR|JPY|SGD|AUD)\b/,
  ],
};

const TOTAL_PRICE: FieldRule = {
  field: 'total_price',
  patterns: [
    /(?:total\s+(?:amount|price|value)|grand\s+total)\s*[:#-]?\s*(?:[A-Z]{3}\s*)?([\d.,]+)/i,
  ],
};

const UNIT_PRICE: FieldRule = {
  field: 'unit_price',
  patterns: [
    /(?:unit\s+(?:price|value))\s*[:#-]?\s*(?:[A-Z]{3}\s*)?([\d.,]+)/i,
  ],
};

const QUANTITY: FieldRule = {
  field: 'quantity',
  patterns: [
    /(?:handling\s+(?:unit\s+)?qty|number\s+of\s+units|no\.?\s+of\s+units|quantity|qty)\s*[:#-]?\s*([\d.,]+)(?:\s+([A-Za-z]+))?/i,
  ],
};

const ORIGIN_COUNTRY: FieldRule = {
  field: 'origin_country',
  patterns: [
    /(?:country\s+of\s+(?:origin|export|manufacture)|origin\s+country)\s*[:#-]?\s*([^\n|]+)/i,
    /country\s*\/\s*terr\.?\s+of\s+mfr\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const DESTINATION_COUNTRY: FieldRule = {
  field: 'destination_country',
  patterns: [
    /(?:country\s+of\s+ultimate\s+destination|ultimate\s+destination|destination\s+country)\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const PORT_OF_LOADING: FieldRule = {
  field: 'port_of_loading',
  patterns: [
    /(?:port\s+of\s+loading|port\s+of\s+export)\s*[:#-]?\s*([^\n|;]+)/i,
    /;\s*([^;\n|]+?)\s*(?:->|→)/i,
  ],
};

const PORT_OF_DISCHARGE: FieldRule = {
  field: 'port_of_discharge',
  patterns: [
    /port\s+of\s+discharge\s*[:#-]?\s*([^\n|;]+)/i,
    /(?:->|→)\s*([^;\n|]+)/i,
  ],
};

const PRODUCT_DESCRIPTION: FieldRule = {
  field: 'product_description',
  patterns: [
    /(?:full\s+description\s+of\s+good(?:s|\(s\))?|description\s+of\s+good(?:s|\(s\))?|goods\s+description|commodity(?:\s+description)?)\s*[:#-]\s*([^\n]+)/i,
  ],
};

const EXPORTER: FieldRule = {
  field: 'exporter_name_address',
  patterns: [
    /(?:ship\s+from|shipper(?:\s*\/\s*exporter)?|exporter(?:\s*\/\s*seller)?|seller)(?:(?:\s*[-–—]\s*|\s+)(?:nama\s*(?:&|and)?\s*alamat|(?:company\s+)?name(?:\s*(?:&|and)\s*address|\/address)?))?\s*[:#-]\s*([^\n|]+)/i,
  ],
};

const CONSIGNEE: FieldRule = {
  field: 'consignee_name_address',
  patterns: [
    /(?:ship\s+to|consignee|importer)(?:(?:\s*[-–—]\s*|\s+)(?:nama\s*(?:&|and)?\s*alamat|(?:company\s+)?name(?:\s*(?:&|and)\s*address|\/address)?))?\s*[:#-]\s*([^\n|]+)/i,
  ],
};

const CERTIFICATE_NUMBER: FieldRule = {
  field: 'certificate_number',
  patterns: [
    /(?:certificate(?:\s+of\s+origin)?|coo)\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const CERTIFICATE_DATE: FieldRule = {
  field: 'certificate_date',
  patterns: [
    /(?:certificate\s+date|date\s+of\s+issue|issue\s+date|certifying\s+date)\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const PRODUCER: FieldRule = {
  field: 'producer_name_address',
  patterns: [
    /(?:supplier\s*\/\s*producer|producer|supplier)(?:\s+name(?:\s*(?:&|and)\s*address|\/address)?)?\s*[:#-]\s*([^\n|]+)/i,
  ],
};

const PACKING_LIST_NUMBER: FieldRule = {
  field: 'packing_list_number',
  patterns: [/packing\s+list\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n|]+)/i],
};

const PACKING_LIST_DATE: FieldRule = {
  field: 'packing_list_date',
  patterns: [/(?:packing\s+list\s+date|ship\s+date)\s*[:#-]?\s*([^\n|]+)/i],
};

const BILL_OF_LADING_NUMBER: FieldRule = {
  field: 'bill_of_lading_number',
  patterns: [
    /(?:bill\s+of\s+lading|b\/l|bol)\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const BILL_OF_LADING_DATE: FieldRule = {
  field: 'bill_of_lading_date',
  patterns: [
    /(?:bill\s+of\s+lading\s+date|b\/l\s+date|bol\s+date|date)\s*[:#-]\s*([^\n|]+)/i,
  ],
};

const CARRIER_NAME: FieldRule = {
  field: 'carrier_name',
  patterns: [/carrier(?:\s+name)?\s*[:#-]\s*([^\n|]+)/i],
};

const VESSEL_NAME: FieldRule = {
  field: 'vessel_name',
  patterns: [/(?:vessel(?:\s+name)?|ocean\s+vessel)\s*[:#-]\s*([^\n|]+)/i],
};

const VOYAGE_NUMBER: FieldRule = {
  field: 'voyage_number',
  patterns: [/voyage\s*(?:number|no\.?|#)?\s*[:#-]\s*([^\n|]+)/i],
};

const CONTAINER_NUMBER: FieldRule = {
  field: 'container_number',
  patterns: [/container\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n|]+)/i],
};

const SEAL_NUMBER: FieldRule = {
  field: 'seal_number',
  patterns: [/seal\s*(?:number(?:\(s\))?|no\.?|#)\s*[:#-]?\s*([^\n|]+)/i],
};

const FREIGHT_TERMS: FieldRule = {
  field: 'freight_terms',
  patterns: [
    /(?:freight\s+charge\s+terms|freight\s+terms)\s*[:#-]?\s*([^\n|]+)/i,
  ],
};

const SPECIAL_INSTRUCTIONS: FieldRule = {
  field: 'special_instructions',
  patterns: [/special\s+instructions?\s*[:#-]?\s*([^\n|]+)/i],
};

const BOL_GROSS_WEIGHT: FieldRule = {
  field: 'gross_weight',
  unit: 'kg',
  patterns: [
    /(?:total\s+)?(?:gross\s+)?weight\s*[:#-]?\s*([\d.,]+)\s*(?:kg|kgs|kilograms?)?/i,
  ],
};

const DOCUMENT_FIELD_RULES: Partial<Record<DocumentType, FieldRule[]>> = {
  [DocumentType.COMMERCIAL_INVOICE]: [
    INVOICE_NUMBER,
    INVOICE_DATE,
    EXPORTER,
    CONSIGNEE,
    ORIGIN_COUNTRY,
    DESTINATION_COUNTRY,
    PACKAGE_COUNT,
    PRODUCT_DESCRIPTION,
    QUANTITY,
    UNIT_PRICE,
    TOTAL_PRICE,
    CURRENCY,
    HS_CODE,
    GROSS_WEIGHT,
    NET_WEIGHT,
    CBM,
  ],
  [DocumentType.PACKING_LIST]: [
    PACKING_LIST_NUMBER,
    PACKING_LIST_DATE,
    INVOICE_NUMBER,
    EXPORTER,
    CONSIGNEE,
    ORIGIN_COUNTRY,
    DESTINATION_COUNTRY,
    PACKAGE_COUNT,
    PACKAGE_TYPE,
    PRODUCT_DESCRIPTION,
    QUANTITY,
    GROSS_WEIGHT,
    NET_WEIGHT,
    CBM,
    HS_CODE,
  ],
  [DocumentType.CERTIFICATE_OF_ORIGIN]: [
    CERTIFICATE_NUMBER,
    CERTIFICATE_DATE,
    INVOICE_NUMBER,
    INVOICE_DATE,
    EXPORTER,
    PRODUCER,
    CONSIGNEE,
    ORIGIN_COUNTRY,
    DESTINATION_COUNTRY,
    PRODUCT_DESCRIPTION,
    QUANTITY,
    HS_CODE,
    GROSS_WEIGHT,
    NET_WEIGHT,
  ],
  [DocumentType.BILL_OF_LADING]: [
    BILL_OF_LADING_NUMBER,
    BILL_OF_LADING_DATE,
    EXPORTER,
    CONSIGNEE,
    CARRIER_NAME,
    VESSEL_NAME,
    VOYAGE_NUMBER,
    CONTAINER_NUMBER,
    SEAL_NUMBER,
    PORT_OF_LOADING,
    PORT_OF_DISCHARGE,
    FREIGHT_TERMS,
    SPECIAL_INSTRUCTIONS,
    PACKAGE_COUNT,
    PACKAGE_TYPE,
    PRODUCT_DESCRIPTION,
    QUANTITY,
    BOL_GROSS_WEIGHT,
    NET_WEIGHT,
    CBM,
    HS_CODE,
  ],
};

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

  extract(
    parsed: ParsedDocument,
    documentType?: DocumentType | null,
  ): ExtractedValue[] {
    const candidates = this.buildCandidates(parsed.blocks);
    const results: ExtractedValue[] = [];
    for (const rule of this.rulesFor(documentType)) {
      const found = this.find(rule, candidates);
      if (found) results.push(found);
    }
    return results;
  }

  private rulesFor(documentType?: DocumentType | null): FieldRule[] {
    const documentRules = documentType
      ? DOCUMENT_FIELD_RULES[documentType]
      : undefined;
    if (documentRules) return documentRules;

    const rules = new Map<string, FieldRule>();
    for (const rule of Object.values(DOCUMENT_FIELD_RULES).flatMap(
      (configuredRules) => configuredRules ?? [],
    )) {
      const existing = rules.get(rule.field);
      if (existing) existing.patterns.push(...rule.patterns);
      else rules.set(rule.field, { ...rule, patterns: [...rule.patterns] });
    }
    return [...rules.values()];
  }

  private find(
    rule: FieldRule,
    candidates: TextCandidate[],
  ): ExtractedValue | null {
    for (const candidate of candidates) {
      for (const pattern of rule.patterns) {
        const match = pattern.exec(candidate.text);
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
          source: {
            ...candidate.source,
            text: candidate.sourceText ?? match[0],
          },
          method: candidate.sourceText
            ? 'regex_deterministic_markdown_table'
            : 'regex_deterministic',
        };
      }
    }
    return null;
  }

  private buildCandidates(blocks: ParsedBlock[]): TextCandidate[] {
    const tableCandidates: TextCandidate[] = [];
    const textCandidates: TextCandidate[] = [];
    for (const [index, block] of blocks.entries()) {
      const previousBlock = blocks[index - 1];
      const context = this.isSectionHeading(previousBlock?.text)
        ? previousBlock.text.trim()
        : null;
      tableCandidates.push(...this.markdownCandidates(block, context));
      textCandidates.push({
        text: block.text,
        source: block,
        sourceText: null,
      });
    }

    const seen = new Set<string>();
    return [...tableCandidates, ...textCandidates].filter((candidate) => {
      const key = `${candidate.source.pageNumber}:${candidate.sourceText ?? ''}:${candidate.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private markdownCandidates(
    block: ParsedBlock,
    context: string | null,
  ): TextCandidate[] {
    const rows = block.text
      .split(/\r?\n/)
      .map((line) => this.parseMarkdownRow(line))
      .filter((row): row is MarkdownRow => row !== null);
    if (!rows.length) return [];

    const candidates: TextCandidate[] = [];
    const add = (text: string, sourceText: string) =>
      candidates.push({ text, source: block, sourceText });

    for (const row of rows) {
      if (this.isSeparatorRow(row) || row.cells.length !== 2) continue;
      const [label, value] = row.cells;
      if (!label || !value) continue;
      add(`${label}: ${value}`, row.sourceText);
      if (context && this.isGenericPartyLabel(label))
        add(`${context} - ${label}: ${value}`, row.sourceText);
    }

    for (let index = 0; index < rows.length - 2; index += 1) {
      const header = rows[index];
      const separator = rows[index + 1];
      if (
        this.isSeparatorRow(header) ||
        !this.isSeparatorRow(separator) ||
        header.cells.length !== separator.cells.length
      )
        continue;

      for (let dataIndex = index + 2; dataIndex < rows.length; dataIndex += 1) {
        const data = rows[dataIndex];
        if (
          this.isSeparatorRow(data) ||
          data.cells.length !== header.cells.length
        )
          break;
        for (
          let cellIndex = 0;
          cellIndex < header.cells.length;
          cellIndex += 1
        ) {
          const label = header.cells[cellIndex];
          const value = data.cells[cellIndex];
          if (label && value) add(`${label}: ${value}`, data.sourceText);
        }
      }
    }

    return candidates;
  }

  private parseMarkdownRow(line: string): MarkdownRow | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) =>
        cell
          .trim()
          .replace(/&#124;/gi, '|')
          .replace(/&amp;/gi, '&')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>'),
      );
    return cells.length >= 2 ? { cells, sourceText: trimmed } : null;
  }

  private isSeparatorRow(row: MarkdownRow): boolean {
    return row.cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  private isGenericPartyLabel(label: string): boolean {
    return /^(?:nama\s*(?:&|and)?\s*alamat|(?:company\s+)?name(?:\s*(?:&|and)\s*address|\/address))$/i.test(
      label.trim(),
    );
  }

  private isSectionHeading(text?: string): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    return trimmed.length > 0 && trimmed.length <= 80 && !/[\n|]/.test(trimmed);
  }

  private score(text: string, keywords: string[]): number {
    return keywords.reduce(
      (total, keyword) => total + (text.includes(keyword) ? 1 : 0),
      0,
    );
  }
}
