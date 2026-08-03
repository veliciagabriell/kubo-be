import { DocumentExtractorService } from './document-extractor.service';
import { ParsedDocument } from './document-intelligence.types';
import { DocumentType } from './entities/document.entity';

describe('DocumentExtractorService', () => {
  const service = new DocumentExtractorService();

  it('classifies commercial invoices from filename and characteristic fields', () => {
    const result = service.classify(
      'commercial-invoice-001.pdf',
      'COMMERCIAL INVOICE\nInvoice Number: INV-001\nUnit Price: USD 10\nTotal Amount: USD 100',
    );

    expect(result.type).toBe(DocumentType.COMMERCIAL_INVOICE);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.method).toContain('rules');
  });

  it('classifies packing lists independently from invoices', () => {
    const result = service.classify(
      'packing-list.pdf',
      'PACKING LIST\nGross Weight: 1,250 KG\nNet Weight: 1,200 KG\nTotal Packages: 25',
    );

    expect(result.type).toBe(DocumentType.PACKING_LIST);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('extracts canonical fields and retains page, text, and bounding box provenance', () => {
    const parsed: ParsedDocument = {
      text: 'Gross Weight: 1,250 KG',
      pages: 2,
      hasTextLayer: true,
      parser: 'docling-standard',
      usedOcr: false,
      blocks: [
        {
          text: [
            'Invoice Number: INV-001',
            'Invoice Date: 01/08/2026',
            'Gross Weight: 1,250 KG',
            'Net Weight: 1,200 KG',
            'HS Code: 520819',
            'Port of Loading: Tanjung Priok',
            'Port of Discharge: Tokyo',
          ].join('\n'),
          pageNumber: 1,
          boundingBox: [420, 236, 585, 260],
        },
      ],
    };

    const fields = service.extract(parsed);
    const grossWeight = fields.find((field) => field.field === 'gross_weight');

    expect(fields.map((field) => field.field)).toEqual(
      expect.arrayContaining([
        'invoice_number',
        'invoice_date',
        'gross_weight',
        'net_weight',
        'hs_code',
        'port_of_loading',
        'port_of_discharge',
      ]),
    );
    expect(grossWeight).toMatchObject({
      value: '1,250',
      unit: 'kg',
      confidence: 0.9,
      method: 'regex_deterministic',
      source: {
        pageNumber: 1,
        boundingBox: [420, 236, 585, 260],
        text: 'Gross Weight: 1,250 KG',
      },
    });
  });
});
