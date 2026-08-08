import { DocumentExtractorService } from './document-extractor.service';
import { ParsedDocument } from './document-intelligence.types';
import { DocumentType } from './entities/document.entity';

describe('DocumentExtractorService', () => {
  const service = new DocumentExtractorService();

  const parsedFromBlocks = (blocks: string[]): ParsedDocument => ({
    text: blocks.join('\n'),
    pages: 1,
    hasTextLayer: true,
    parser: 'docling-2.81.0',
    usedOcr: false,
    blocks: blocks.map((text) => ({
      text,
      pageNumber: 1,
      boundingBox: null,
    })),
  });

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

  it('extracts Bill of Lading fields from Docling Markdown tables', () => {
    const parsed = parsedFromBlocks([
      'BILL OF LADING',
      [
        '| Date               | 22 August 2026 (estimated)   |',
        '|--------------------|------------------------------|',
        '| Bill of Lading No. | TEST-BOL-KUBO-20260822-001   |',
      ].join('\n'),
      'Ship From',
      [
        '| Nama &Alamat | Aleka Ukiran, Jepara, Indonesia |',
        '|---------------|----------------------------------|',
      ].join('\n'),
      'Ship To',
      [
        '| Nama &Alamat | Mori Living, Tokyo, Japan |',
        '|---------------|---------------------------|',
      ].join('\n'),
      'Carrier Information',
      [
        '| Carrier Name         | KUBO Freight          |',
        '|----------------------|-----------------------|',
        '| Special Instructions | TBC; Tanjung Emas -> Tokyo/Yokohama; slot confirmed |',
      ].join('\n'),
      'Commodity Description',
      [
        '| Handling Qty | Handling Type | Package Qty | Package Type   | Weight | Commodity                                               |',
        '|--------------|---------------|-------------|----------------|--------|---------------------------------------------------------|',
        '| 15           | Unit          | 15          | Layered carton | 139 kg | Ukiran Jepara HS 9403.60 &#124; Net 135 kg &#124; 4 CBM |',
      ].join('\n'),
    ]);

    const fields = service.extract(parsed, DocumentType.BILL_OF_LADING);
    const values = Object.fromEntries(
      fields.map((field) => [field.field, field.value]),
    );

    expect(values).toMatchObject({
      bill_of_lading_number: 'TEST-BOL-KUBO-20260822-001',
      bill_of_lading_date: '22 August 2026 (estimated)',
      exporter_name_address: 'Aleka Ukiran, Jepara, Indonesia',
      consignee_name_address: 'Mori Living, Tokyo, Japan',
      carrier_name: 'KUBO Freight',
      port_of_loading: 'Tanjung Emas',
      port_of_discharge: 'Tokyo/Yokohama',
      package_count: '15',
      package_type: 'Layered carton',
      product_description: 'Ukiran Jepara HS 9403.60 | Net 135 kg | 4 CBM',
      quantity: '15',
      gross_weight: '139',
      net_weight: '135',
      cbm: '4',
      hs_code: '9403.60',
    });
    expect(
      fields.find((field) => field.field === 'bill_of_lading_number'),
    ).toMatchObject({
      method: 'regex_deterministic_markdown_table',
      source: {
        text: '| Bill of Lading No. | TEST-BOL-KUBO-20260822-001   |',
      },
    });
  });

  it('extracts Commercial Invoice fields from key-value and item tables', () => {
    const parsed = parsedFromBlocks([
      [
        '| Invoice Number                    | INV-2026-001              |',
        '|-----------------------------------|---------------------------|',
        '| Date of Exportation               | 22 August 2026            |',
        '| Shipper/Exporter Name and Address | Aleka Ukiran, Indonesia   |',
        '| Consignee Name and Address        | Mori Living, Japan        |',
        '| Country of Export                 | Indonesia                 |',
        '| Country of Ultimate Destination   | Japan                     |',
      ].join('\n'),
      [
        '| No. of Pkgs | Full Description of Goods | Qty     | Unit Value | Total Value |',
        '|-------------|---------------------------|---------|------------|-------------|',
        '| 2           | Ukiran Jepara HS 9403.60   | 15 unit | USD 10.00  | USD 150.00  |',
      ].join('\n'),
    ]);

    const fields = service.extract(parsed, DocumentType.COMMERCIAL_INVOICE);
    const values = Object.fromEntries(
      fields.map((field) => [field.field, field.value]),
    );

    expect(values).toMatchObject({
      invoice_number: 'INV-2026-001',
      invoice_date: '22 August 2026',
      exporter_name_address: 'Aleka Ukiran, Indonesia',
      consignee_name_address: 'Mori Living, Japan',
      origin_country: 'Indonesia',
      destination_country: 'Japan',
      package_count: '2',
      product_description: 'Ukiran Jepara HS 9403.60',
      quantity: '15',
      unit_price: '10.00',
      total_price: '150.00',
      currency: 'USD',
      hs_code: '9403.60',
    });
  });

  it('extracts Certificate of Origin fields from Docling tables', () => {
    const parsed = parsedFromBlocks([
      [
        '| Certificate of Origin No.              | COO-2026-001              |',
        '|----------------------------------------|---------------------------|',
        '| Date of Issue                          | 22 August 2026            |',
        '| 1. Exporter/Seller Name and Address    | Aleka Ukiran, Indonesia   |',
        '| 3. Supplier/Producer Name and Address  | Aleka Workshop, Indonesia |',
        '| 4. Importer Name and Address           | Mori Living, Japan        |',
      ].join('\n'),
      [
        '| 5. Description of Good(s) | 6. HS Tariff Classification (6 digit) | 7. Country of Origin |',
        '|---------------------------|-----------------------------------------|----------------------|',
        '| Ukiran Jepara             | 9403.60                                 | Indonesia            |',
      ].join('\n'),
    ]);

    const fields = service.extract(parsed, DocumentType.CERTIFICATE_OF_ORIGIN);
    const values = Object.fromEntries(
      fields.map((field) => [field.field, field.value]),
    );

    expect(values).toMatchObject({
      certificate_number: 'COO-2026-001',
      certificate_date: '22 August 2026',
      exporter_name_address: 'Aleka Ukiran, Indonesia',
      producer_name_address: 'Aleka Workshop, Indonesia',
      consignee_name_address: 'Mori Living, Japan',
      product_description: 'Ukiran Jepara',
      hs_code: '9403.60',
      origin_country: 'Indonesia',
    });
  });

  it('extracts Packing List fields from Docling tables', () => {
    const parsed = parsedFromBlocks([
      [
        '| Packing List No.                 | PL-2026-001              |',
        '|----------------------------------|--------------------------|',
        '| Ship Date                        | 22 August 2026           |',
        '| Exporter - Company Name/Address  | Aleka Ukiran, Indonesia  |',
        '| Consignee - Company Name/Address | Mori Living, Japan       |',
        '| Invoice No.                      | INV-2026-001             |',
        '| Total Gross Weight               | 139 kg                   |',
      ].join('\n'),
      [
        '| No. of Packages | No. of Units | Net Weight | Unit of Measure | Description of Goods      | Country/Terr. of MFR |',
        '|-----------------|--------------|------------|-----------------|---------------------------|----------------------|',
        '| 2               | 15           | 135 kg     | unit            | Ukiran Jepara HS 9403.60  | Indonesia            |',
      ].join('\n'),
    ]);

    const fields = service.extract(parsed, DocumentType.PACKING_LIST);
    const values = Object.fromEntries(
      fields.map((field) => [field.field, field.value]),
    );

    expect(values).toMatchObject({
      packing_list_number: 'PL-2026-001',
      packing_list_date: '22 August 2026',
      invoice_number: 'INV-2026-001',
      exporter_name_address: 'Aleka Ukiran, Indonesia',
      consignee_name_address: 'Mori Living, Japan',
      package_count: '2',
      product_description: 'Ukiran Jepara HS 9403.60',
      quantity: '15',
      gross_weight: '139',
      net_weight: '135',
      hs_code: '9403.60',
      origin_country: 'Indonesia',
    });
  });
});
