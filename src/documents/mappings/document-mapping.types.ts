import { CanonicalShipmentData } from '../canonical/canonical-shipment.types';

export interface MappedDocumentData {
  fields: Record<string, string>;
  items: Record<string, string>[];
}

export type DocumentMapper = (
  canonical: CanonicalShipmentData,
  overrides?: Record<string, string>,
) => MappedDocumentData;

export function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  )
    return '';
  return String(value).trim();
}

export function combine(...values: unknown[]): string {
  return values.map(text).filter(Boolean).join('\n');
}

export function prefer(
  overrides: Record<string, string> | undefined,
  keys: string[],
  fallback: unknown,
): string {
  for (const key of keys) {
    const value = overrides?.[key];
    if (value?.trim()) return value.trim();
  }
  return text(fallback);
}

export function amount(value: number | undefined, currency?: string): string {
  if (value === undefined) return '';
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value);
  return [currency, formatted].filter(Boolean).join(' ');
}
