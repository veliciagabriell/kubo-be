import { Injectable } from '@nestjs/common';
import { DocumentType } from '../entities/document.entity';
import { MappedDocumentData } from '../mappings/document-mapping.types';
import { DocumentTemplateDefinition } from '../templates/document-template.registry';

type PdfRow = { label: string; value: string };
type PdfSection = { title: string; rows: PdfRow[] };

function ascii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapped(value: string, limit: number): string[] {
  return value.split(/\r?\n/).flatMap((part) => {
    const words = part.split(/\s+/).filter(Boolean);
    const output: string[] = [];
    let current = '';
    words.forEach((word) => {
      if (current && `${current} ${word}`.length > limit) {
        output.push(current);
        current = word;
      } else current = `${current} ${word}`.trim();
    });
    if (current) output.push(current);
    return output.length ? output : [''];
  });
}

function sections(type: DocumentType, data: MappedDocumentData): PdfSection[] {
  const f = data.fields;
  const row = (label: string, key: string): PdfRow => ({
    label,
    value: f[key] || '',
  });
  switch (type) {
    case DocumentType.BILL_OF_LADING:
      return [
        {
          title: '',
          rows: [
            row('Date', 'bolDate'),
            row('Bill of Lading No.', 'bolNumber'),
          ],
        },
        {
          title: 'Ship From',
          rows: [
            row('Name & Address', 'shipFromNameAddress'),
            row('SID#', 'shipFromSid'),
          ],
        },
        {
          title: 'Ship To',
          rows: [
            row('Name & Address', 'shipToNameAddress'),
            row('Location No.', 'shipToLocationNo'),
            row('CID#', 'shipToCid'),
          ],
        },
        {
          title: 'Carrier Information',
          rows: [
            row('Carrier Name', 'carrierName'),
            row('Container / Trailer No.', 'containerNumber'),
            row('Seal Number(s)', 'sealNumbers'),
            row('SCAC', 'scac'),
            row('Voyage / Pro No.', 'voyageNumber'),
          ],
        },
        {
          title: 'Freight Charges',
          rows: [
            row('Third Party Freight Charges - Bill To', 'thirdPartyBillTo'),
            row('Freight Charge Terms', 'freightChargeTerms'),
            row('COD Amount', 'codAmount'),
            row('Special Instructions', 'specialInstructions'),
          ],
        },
      ];
    case DocumentType.COMMERCIAL_INVOICE:
      return [
        {
          title: '',
          rows: [
            row('Date of Exportation', 'dateOfExportation'),
            row('Invoice Number', 'invoiceNumber'),
            row('Airwaybill No.', 'airwaybillNo'),
          ],
        },
        {
          title: 'Shipper / Exporter',
          rows: [row('Name & Address', 'shipperNameAddress')],
        },
        {
          title: 'Consignee',
          rows: [row('Name & Address', 'consigneeNameAddress')],
        },
        {
          title: 'Importer (if applicable)',
          rows: [row('Name & Address', 'importerNameAddress')],
        },
        {
          title: 'Country',
          rows: [
            row('Country of Export', 'countryOfExport'),
            row('Country of Manufacture', 'countryOfManufacture'),
            row(
              'Country of Ultimate Destination',
              'countryOfUltimateDestination',
            ),
          ],
        },
        {
          title: 'Invoice Total',
          rows: [row('Total Invoice Value', 'totalInvoiceValue')],
        },
        {
          title: 'Declaration / Signature',
          rows: [row('Signature of Shipper / Exporter', 'signatureName')],
        },
      ];
    case DocumentType.PACKING_LIST:
      return [
        {
          title: 'Exporter',
          rows: [
            row('Company Name / Address', 'exporterCompanyAddress'),
            row('Tax ID', 'exporterTaxId'),
            row('Contact', 'exporterContactName'),
            row('Telephone', 'exporterTelephone'),
            row('Email', 'exporterEmail'),
            row('Country', 'exporterCountry'),
          ],
        },
        {
          title: 'Consignee',
          rows: [
            row('Company Name / Address', 'consigneeCompanyAddress'),
            row('Tax ID', 'consigneeTaxId'),
            row('Contact', 'consigneeContactName'),
            row('Telephone', 'consigneeTelephone'),
            row('Email', 'consigneeEmail'),
            row('Country', 'consigneeCountry'),
          ],
        },
        {
          title: 'Shipment Information',
          rows: [
            row('Ship Date', 'shipDate'),
            row('Tracking / BOL', 'billOfLading'),
            row('Invoice Number', 'invoiceNo'),
            row('Purchase Order', 'purchaseOrderNo'),
            row('Payment Terms', 'paymentTerms'),
            row('Package Type', 'packageType'),
            row('Special Instructions', 'specialInstructions'),
          ],
        },
        {
          title: 'Totals',
          rows: [row('Total Gross Weight', 'totalGrossWeight')],
        },
        {
          title: 'Declaration / Signature',
          rows: [row('Signature / Title / Date', 'signatureNameTitleDate')],
        },
      ];
    case DocumentType.CERTIFICATE_OF_ORIGIN:
      return [
        {
          title: '1. Exporter / Seller',
          rows: [
            row('Name and Address', 'exporterNameAddress'),
            row('Tax Identification Number', 'exporterTaxId'),
          ],
        },
        {
          title: '2. Blanket Period',
          rows: [
            row('From', 'blanketPeriodFrom'),
            row('To', 'blanketPeriodTo'),
          ],
        },
        {
          title: '3. Supplier / Producer',
          rows: [row('Name and Address', 'producerNameAddress')],
        },
        {
          title: '4. Importer',
          rows: [row('Name and Address', 'importerNameAddress')],
        },
        {
          title: '8. Certifying Person / Entity',
          rows: [
            row('Role', 'certifyingRole'),
            row('Company', 'certifyingCompany'),
            row('Name', 'certifyingName'),
            row('Title', 'certifyingTitle'),
            row('Date', 'certifyingDate'),
            row('Telephone / Facsimile', 'certifyingTelephone'),
          ],
        },
      ];
    default:
      return [];
  }
}

function itemHeaders(type: DocumentType): string[] {
  switch (type) {
    case DocumentType.BILL_OF_LADING:
      return [
        'Handling Qty',
        'Type',
        'Package Qty',
        'Package Type',
        'Weight',
        'Commodity Description',
        'NMFC',
        'Class',
      ];
    case DocumentType.COMMERCIAL_INVOICE:
      return [
        'No. of Packages',
        'Description',
        'Quantity',
        'Unit Value',
        'Total Value',
      ];
    case DocumentType.PACKING_LIST:
      return [
        'Packages',
        'Units',
        'Net Weight',
        'Unit',
        'Description',
        'Country of Manufacture',
      ];
    case DocumentType.CERTIFICATE_OF_ORIGIN:
      return [
        'Description of Goods',
        'HS Tariff Classification',
        'Country of Origin',
      ];
    default:
      return [];
  }
}

function itemKeys(type: DocumentType): string[] {
  switch (type) {
    case DocumentType.BILL_OF_LADING:
      return [
        'handlingUnitQty',
        'handlingUnitType',
        'packageQty',
        'packageType',
        'weight',
        'goodsDescription',
        'nmfcNo',
        'freightClass',
      ];
    case DocumentType.COMMERCIAL_INVOICE:
      return ['noOfPkgs', 'goodsDescription', 'qty', 'unitValue', 'totalValue'];
    case DocumentType.PACKING_LIST:
      return [
        'noOfPackages',
        'noOfUnits',
        'netWeight',
        'unitOfMeasure',
        'goodsDescription',
        'countryOfManufacture',
      ];
    case DocumentType.CERTIFICATE_OF_ORIGIN:
      return ['goodsDescription', 'hsCode', 'countryOfOrigin'];
    default:
      return [];
  }
}

@Injectable()
export class TemplatePdfRenderer {
  render(
    definition: DocumentTemplateDefinition,
    data: MappedDocumentData,
  ): Buffer {
    const pageCommands: string[][] = [[]];
    let page = 0;
    let y = 800;
    const command = (value: string) => pageCommands[page].push(value);
    const nextPage = () => {
      page += 1;
      pageCommands.push([]);
      y = 800;
    };
    const ensure = (height: number) => {
      if (y - height < 45) nextPage();
    };
    const textAt = (
      x: number,
      top: number,
      value: string,
      size = 9,
      bold = false,
    ) => {
      command(
        `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${top} Td (${ascii(value)}) Tj ET`,
      );
    };
    const box = (x: number, top: number, width: number, height: number) => {
      command(`${x} ${top - height} ${width} ${height} re S`);
    };
    const title = () => {
      textAt(42, y, definition.label.toUpperCase(), 17, true);
      textAt(425, y, 'KUBO AI Draft', 8, false);
      y -= 25;
    };
    title();
    sections(definition.type, data).forEach((section) => {
      const estimated =
        (section.title ? 21 : 0) +
        section.rows.reduce(
          (sum, item) =>
            sum + Math.max(30, wrapped(item.value, 52).length * 11 + 12),
          0,
        );
      ensure(estimated);
      if (section.title) {
        box(42, y, 528, 21);
        command('0.93 g 42 ' + (y - 21) + ' 528 21 re f 0 g');
        textAt(48, y - 14, section.title, 10, true);
        y -= 21;
      }
      section.rows.forEach((item) => {
        const valueLines = wrapped(item.value || ' ', 52);
        const height = Math.max(30, valueLines.length * 11 + 12);
        ensure(height);
        box(42, y, 180, height);
        box(222, y, 348, height);
        textAt(48, y - 17, item.label, 8, true);
        valueLines.forEach((line, index) =>
          textAt(228, y - 16 - index * 11, line, 9),
        );
        y -= height;
      });
      y -= 10;
    });

    ensure(90);
    const headers = itemHeaders(definition.type);
    const keys = itemKeys(definition.type);
    const tableTitle =
      definition.type === DocumentType.BILL_OF_LADING
        ? 'Commodity Description'
        : definition.type === DocumentType.CERTIFICATE_OF_ORIGIN
          ? '5-7. Description of Goods'
          : 'Goods';
    textAt(42, y, tableTitle, 10, true);
    y -= 15;
    const width = 528 / headers.length;
    headers.forEach((header, index) => {
      box(42 + index * width, y, width, 32);
      wrapped(header, Math.max(8, Math.floor(width / 5.5)))
        .slice(0, 2)
        .forEach((line, lineIndex) =>
          textAt(45 + index * width, y - 12 - lineIndex * 9, line, 6.5, true),
        );
    });
    y -= 32;
    data.items.forEach((item) => {
      const height = 48;
      ensure(height);
      keys.forEach((key, index) => {
        box(42 + index * width, y, width, height);
        wrapped(item[key] || '', Math.max(6, Math.floor(width / 5)))
          .slice(0, 4)
          .forEach((line, lineIndex) =>
            textAt(45 + index * width, y - 12 - lineIndex * 9, line, 6.5),
          );
      });
      y -= height;
    });
    pageCommands.forEach((commands) => {
      commands.push(
        'BT /F1 7 Tf 42 24 Td (KUBO AI Draft - Not an official carrier or government-issued document.) Tj ET',
      );
    });

    const pageCount = pageCommands.length;
    const fontObject = 3 + pageCount * 2;
    const boldFontObject = fontObject + 1;
    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageCommands.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`;
    pageCommands.forEach((commands, index) => {
      const pageObject = 3 + index * 2;
      const contentObject = pageObject + 1;
      const stream = ['0.7 w', ...commands].join('\n');
      objects[pageObject] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontObject} 0 R /F2 ${boldFontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`;
      objects[contentObject] =
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    });
    objects[fontObject] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[boldFontObject] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    let output = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (let index = 1; index < objects.length; index += 1) {
      offsets[index] = Buffer.byteLength(output, 'latin1');
      output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(output, 'latin1');
    output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let index = 1; index < objects.length; index += 1)
      output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(output, 'latin1');
  }
}
