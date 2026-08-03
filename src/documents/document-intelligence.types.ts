import { DocumentType } from './entities/document.entity';

export interface ParsedBlock {
  text: string;
  pageNumber: number | null;
  boundingBox: number[] | null;
}

export interface ParsedDocument {
  text: string;
  pages: number;
  hasTextLayer: boolean;
  parser: string;
  usedOcr: boolean;
  blocks: ParsedBlock[];
}

export interface ExtractedValue {
  field: string;
  value: string;
  unit: string | null;
  confidence: number;
  source: ParsedBlock;
  method: string;
}

export interface ClassificationResult {
  type: DocumentType | null;
  confidence: number;
  method: string;
}

export interface RemoteParseResponse {
  text: string;
  pages?: number;
  has_text_layer?: boolean;
  parser?: string;
  used_ocr?: boolean;
  blocks?: Array<{
    text: string;
    page?: number;
    bounding_box?: number[];
  }>;
}
