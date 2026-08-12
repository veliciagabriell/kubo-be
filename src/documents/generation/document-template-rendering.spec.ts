import JSZip from 'jszip';
import { CanonicalShipmentData } from '../canonical/canonical-shipment.types';
import { DocumentType } from '../entities/document.entity';
import { DocxTemplateRenderer } from '../renderers/docx-template.renderer';
import { TemplatePdfRenderer } from '../renderers/template-pdf.renderer';
import { DocumentTemplateRegistry } from '../templates/document-template.registry';

const canonical: CanonicalShipmentData = {
  shipmentId: 'shipment-1',
  shipmentCode: 'KUB-24081',
  exporter: {
    companyName: 'Aleka Ukiran',
    contactName: 'Aleka Permana',
    address: 'Jalan Jepara 3 Hutama, Jepara',
    country: 'Indonesia',
    taxId: 'NIB-123',
    email: 'aleka@example.com',
  },
  consignee: {
    companyName: 'Mori Living',
    contactName: 'Aiko Tanaka',
    address: 'Aomi, Tokyo',
    country: 'Japan',
  },
  cargo: {
    description: 'Ukiran Jepara',
    hsCode: '9403.60',
    quantity: 15,
    quantityUnit: 'units',
    grossWeightKg: 139,
    netWeightKg: 135,
    finalCbm: 4,
    packageCount: 6,
    packageType: 'Layered cartons',
    countryOfOrigin: 'Indonesia',
    unitPrice: 100,
    totalValue: 1500,
  },
  items: [
    {
      description: 'Ukiran Jepara Chair',
      hsCode: '9403.60',
      quantity: 10,
      quantityUnit: 'units',
      grossWeightKg: 90,
      netWeightKg: 87,
      packageCount: 4,
      packageType: 'Layered cartons',
      countryOfOrigin: 'Indonesia',
      unitPrice: 100,
      totalValue: 1000,
    },
    {
      description: 'Ukiran Jepara Table',
      hsCode: '9403.60',
      quantity: 5,
      quantityUnit: 'units',
      grossWeightKg: 49,
      netWeightKg: 48,
      packageCount: 2,
      packageType: 'Layered cartons',
      countryOfOrigin: 'Indonesia',
      unitPrice: 100,
      totalValue: 500,
    },
  ],
  route: {
    originPort: 'Tanjung Emas',
    destinationPort: 'Tokyo / Yokohama',
    originCountry: 'Indonesia',
    destinationCountry: 'Japan',
    cargoReadyDate: '2026-08-24',
    estimatedDeparture: '2026-08-22',
    cargoCutoff: '2026-08-17',
  },
  containerMatch: {
    freightForwarderName: 'KUBO Freight Partner',
    vesselName: 'KUBO DEV NUSANTARA',
    voyageNumber: 'KDN-2026-08',
    containerNumber: 'TBC',
    sealNumber: 'TBC',
  },
  commercial: {
    invoiceNumber: 'INV-KUB-24081-01',
    invoiceDate: '2026-08-20',
    currency: 'USD',
    unitPrice: 100,
    totalValue: 1500,
    paymentTerms: 'Prepaid',
  },
  billOfLading: { number: 'TBC' },
  facts: { exporter_title: 'Owner' },
};

describe('template based document rendering', () => {
  const registry = new DocumentTemplateRegistry();
  const docxRenderer = new DocxTemplateRenderer();
  const pdfRenderer = new TemplatePdfRenderer();
  const forbidden = [
    'DOCUMENT FIELDS',
    'shipFromNameAddress:',
    'bolNumber:',
    'measurementCbm:',
  ];

  async function render(type: DocumentType) {
    const definition = registry.get(type);
    const mapped = definition.mapper(canonical);
    const docx = await docxRenderer.render(
      registry.resolvePath(definition),
      definition,
      mapped,
    );
    const zip = await JSZip.loadAsync(docx);
    const xml = await zip.file('word/document.xml')!.async('string');
    const pdf = pdfRenderer.render(definition, mapped).toString('latin1');
    forbidden.forEach((value) => {
      expect(xml).not.toContain(value);
      expect(pdf).not.toContain(value);
    });
    return { xml, pdf };
  }

  it('fills Bill of Lading parties, route, vessel and goods inside template tables', async () => {
    const { xml, pdf } = await render(DocumentType.BILL_OF_LADING);
    expect(xml).toContain('Aleka Ukiran');
    expect(xml).toContain('Mori Living');
    expect(xml).toContain('Tanjung Emas');
    expect(xml).toContain('Tokyo / Yokohama');
    expect(xml).toContain('KUBO DEV NUSANTARA');
    expect(xml).toContain('Ukiran Jepara Chair');
    expect(pdf).toContain('BILL OF LADING');
  });

  it('fills Commercial Invoice parties, values and one table row per item', async () => {
    const { xml } = await render(DocumentType.COMMERCIAL_INVOICE);
    expect(xml).toContain('INV-KUB-24081-01');
    expect(xml).toContain('Aleka Ukiran');
    expect(xml).toContain('Mori Living');
    expect(xml).toContain('USD 1,000');
    expect(xml).toContain('USD 500');
  });

  it('fills Packing List packaging, weights and multiple goods rows', async () => {
    const { xml } = await render(DocumentType.PACKING_LIST);
    expect(xml).toContain('139 kg');
    expect(xml).toContain('87 kg');
    expect(xml).toContain('48 kg');
    expect(xml).toContain('Layered cartons');
    expect(xml).toContain('Ukiran Jepara Table');
  });

  it('fills Certificate of Origin exporter, importer, HS code and origin', async () => {
    const { xml } = await render(DocumentType.CERTIFICATE_OF_ORIGIN);
    expect(xml).toContain('Aleka Ukiran');
    expect(xml).toContain('Mori Living');
    expect(xml).toContain('9403.60');
    expect(xml).toContain('Indonesia');
    expect(xml).toContain('Ukiran Jepara Chair');
  });
});
