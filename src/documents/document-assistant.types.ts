export type FieldSourceType =
  | 'company_profile'
  | 'shipment'
  | 'cargo'
  | 'container_match'
  | 'vessel_match'
  | 'uploaded_document'
  | 'generated_document'
  | 'freight_forwarder';

export type FieldValidationStatus =
  | 'valid'
  | 'missing'
  | 'invalid'
  | 'conflict'
  | 'needs_confirmation'
  | 'waiting_external_data';

export interface FieldSource {
  documentId?: string;
  documentType?: string;
  fileName?: string;
  page?: number;
  rawText?: string;
  boundingBox?: number[];
  sourceType: FieldSourceType;
  label: string;
}

export interface ConflictCandidate {
  value: string;
  normalizedValue: string;
  unit?: string;
  source: FieldSource;
}

export interface DocumentField<T = string> {
  key: string;
  canonicalKey: string;
  label: string;
  required: boolean;
  userEditable: boolean;
  value?: T;
  normalizedValue?: T;
  unit?: string;
  status: FieldValidationStatus;
  confidence?: number;
  sources: FieldSource[];
  conflictCandidates?: ConflictCandidate[];
  externalMessage?: string;
}

export interface DocumentReadiness {
  totalFields: number;
  validFields: number;
  missingFields: number;
  conflictFields: number;
  invalidFields: number;
  confirmationFields: number;
  waitingExternalFields: number;
  readinessPercent: number;
  canGenerateDraft: boolean;
}
