import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { DocumentType } from './entities/document.entity';

const NO_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
};

function title(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text, bold: true })],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text, bold: true })],
  });
}

function cell(
  text: string,
  opts: { bold?: boolean; width?: number; shaded?: boolean } = {},
): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shaded ? { fill: 'E8E8E8' } : undefined,
    borders: NO_BORDER,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({ children: [new TextRun({ text: text || '-', bold: opts.bold })] }),
    ],
  });
}

function infoTable(rows: { label: string; value: string }[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [cell(r.label, { bold: true, width: 30 }), cell(r.value, { width: 70 })],
        }),
    ),
  });
}

function itemsTable(
  columns: { key: string; label: string }[],
  items: Record<string, string>[],
): Table {
  const width = 100 / columns.length;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: columns.map((c) => cell(c.label, { bold: true, width, shaded: true })),
      }),
      ...items.map(
        (item) =>
          new TableRow({
            children: columns.map((c) => cell(item[c.key] ?? '-', { width })),
          }),
      ),
    ],
  });
}

function buildCertificateOfOrigin(
  fields: Record<string, string>,
  items: Record<string, string>[],
): Paragraph | Table[] {
  return [
    title('CERTIFICATE OF ORIGIN'),
    sectionHeading('1. Exporter or Seller'),
    infoTable([
      { label: 'Nama & Alamat', value: fields.exporterNameAddress },
      { label: 'Tax Identification Number', value: fields.exporterTaxId },
    ]),
    sectionHeading('2. Blanket Period'),
    infoTable([
      { label: 'Dari (DD/MM/YY)', value: fields.blanketPeriodFrom },
      { label: 'Sampai (DD/MM/YY)', value: fields.blanketPeriodTo },
    ]),
    sectionHeading('3. Supplier or Producer'),
    infoTable([{ label: 'Nama & Alamat', value: fields.producerNameAddress || 'SAME' }]),
    sectionHeading('4. Importer'),
    infoTable([{ label: 'Nama & Alamat', value: fields.importerNameAddress }]),
    sectionHeading('5–7. Description of Good(s)'),
    itemsTable(
      [
        { key: 'goodsDescription', label: 'Description of Good(s)' },
        { key: 'hsCode', label: 'HS Tariff Classification (6 digit)' },
        { key: 'countryOfOrigin', label: 'Country of Origin' },
      ],
      items,
    ),
    sectionHeading('8. Certifying Person or Entity'),
    infoTable([
      { label: 'Menyatakan sebagai', value: fields.certifyingRole },
      { label: 'Company', value: fields.certifyingCompany },
      { label: 'Name', value: fields.certifyingName },
      { label: 'Title', value: fields.certifyingTitle },
      { label: 'Date (DD/MM/YY)', value: fields.certifyingDate },
      { label: 'Telephone / Facsimile', value: fields.certifyingTelephone },
    ]),
  ] as unknown as Paragraph | Table[];
}

function buildCommercialInvoice(fields: Record<string, string>, items: Record<string, string>[]) {
  const total = items.reduce((sum, i) => {
    const v = parseFloat((i.totalValue || '').replace(/[^0-9.-]/g, ''));
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);

  return [
    title('COMMERCIAL INVOICE'),
    infoTable([
      { label: 'Date of Exportation', value: fields.dateOfExportation },
      { label: 'Airwaybill No.', value: fields.airwaybillNo },
    ]),
    sectionHeading('Shipper / Exporter'),
    infoTable([{ label: 'Nama & Alamat', value: fields.shipperNameAddress }]),
    sectionHeading('Consignee'),
    infoTable([{ label: 'Nama & Alamat', value: fields.consigneeNameAddress }]),
    sectionHeading('Importer (jika berbeda dari Consignee)'),
    infoTable([{ label: 'Nama & Alamat', value: fields.importerNameAddress }]),
    sectionHeading('Country'),
    infoTable([
      { label: 'Country of Export', value: fields.countryOfExport },
      { label: 'Country of Manufacture', value: fields.countryOfManufacture },
      { label: 'Country of Ultimate Destination', value: fields.countryOfUltimateDestination },
    ]),
    sectionHeading('Full Description of Goods'),
    itemsTable(
      [
        { key: 'noOfPkgs', label: 'No. of Pkgs' },
        { key: 'goodsDescription', label: 'Full Description of Goods' },
        { key: 'qty', label: 'Qty' },
        { key: 'unitValue', label: 'Unit Value' },
        { key: 'totalValue', label: 'Total Value' },
      ],
      items,
    ),
    infoTable([{ label: 'Total Invoice Value', value: total ? total.toFixed(2) : '-' }]),
    sectionHeading('Declaration'),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun('I declare all that information contained in this invoice to be true and correct.'),
      ],
    }),
    infoTable([{ label: 'Signature of Shipper/Exporter', value: fields.signatureName }]),
  ];
}

function buildPackingList(fields: Record<string, string>, items: Record<string, string>[]) {
  return [
    title('PACKING LIST'),
    sectionHeading('Exporter'),
    infoTable([
      { label: 'Company Name/Address', value: fields.exporterCompanyAddress },
      { label: 'Tax ID#', value: fields.exporterTaxId },
      { label: 'Contact Name', value: fields.exporterContactName },
      { label: 'Telephone No.', value: fields.exporterTelephone },
      { label: 'E-Mail', value: fields.exporterEmail },
      { label: 'Country/Territory', value: fields.exporterCountry },
    ]),
    sectionHeading('Consignee'),
    infoTable([
      { label: 'Company Name/Address', value: fields.consigneeCompanyAddress },
      { label: 'Tax ID#', value: fields.consigneeTaxId },
      { label: 'Contact Name', value: fields.consigneeContactName },
      { label: 'Telephone No.', value: fields.consigneeTelephone },
      { label: 'E-Mail', value: fields.consigneeEmail },
      { label: 'Country/Territory', value: fields.consigneeCountry },
    ]),
    sectionHeading('Shipment Info'),
    infoTable([
      { label: 'Ship Date', value: fields.shipDate },
      { label: 'Air Waybill No. / Tracking No.', value: fields.airWaybillNo },
      { label: 'Invoice No.', value: fields.invoiceNo },
      { label: 'Purchase Order No.', value: fields.purchaseOrderNo },
      { label: 'Payment Terms', value: fields.paymentTerms },
      { label: 'Bill of Lading', value: fields.billOfLading },
      { label: 'Package Type', value: fields.packageType },
      { label: 'Special Instructions', value: fields.specialInstructions },
    ]),
    sectionHeading('Description of Goods'),
    itemsTable(
      [
        { key: 'noOfPackages', label: 'No. of Packages' },
        { key: 'noOfUnits', label: 'No. of Units' },
        { key: 'netWeight', label: 'Net Weight' },
        { key: 'unitOfMeasure', label: 'Unit of Measure' },
        { key: 'goodsDescription', label: 'Description of Goods' },
        { key: 'countryOfManufacture', label: 'Country/Terr. of MFR' },
      ],
      items,
    ),
    infoTable([{ label: 'Total Gross Weight', value: fields.totalGrossWeight }]),
    sectionHeading('Declaration'),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun('I declare that all the information contained in this packing list to be true and correct.'),
      ],
    }),
    infoTable([{ label: 'Signature / Title / Date', value: fields.signatureNameTitleDate }]),
  ];
}

function buildBillOfLading(fields: Record<string, string>, items: Record<string, string>[]) {
  return [
    title('BILL OF LADING'),
    infoTable([
      { label: 'Date', value: fields.bolDate },
      { label: 'Bill of Lading No.', value: fields.bolNumber },
    ]),
    sectionHeading('Ship From'),
    infoTable([
      { label: 'Nama & Alamat', value: fields.shipFromNameAddress },
      { label: 'SID#', value: fields.shipFromSid },
    ]),
    sectionHeading('Ship To'),
    infoTable([
      { label: 'Nama & Alamat', value: fields.shipToNameAddress },
      { label: 'Location No.', value: fields.shipToLocationNo },
      { label: 'CID#', value: fields.shipToCid },
    ]),
    sectionHeading('Carrier Information'),
    infoTable([
      { label: 'Carrier Name', value: fields.carrierName },
      { label: 'Trailer No.', value: fields.trailerNo },
      { label: 'Seal Number(s)', value: fields.sealNumbers },
      { label: 'SCAC', value: fields.scac },
      { label: 'Pro No.', value: fields.proNo },
    ]),
    sectionHeading('Freight Charges'),
    infoTable([
      { label: 'Third Party Freight Charges – Bill To', value: fields.thirdPartyBillTo },
      { label: 'Freight Charge Terms', value: fields.freightChargeTerms },
      { label: 'COD Amount', value: fields.codAmount },
      { label: 'Special Instructions', value: fields.specialInstructions },
    ]),
    sectionHeading('Commodity Description'),
    itemsTable(
      [
        { key: 'handlingUnitQty', label: 'Handling Unit Qty' },
        { key: 'handlingUnitType', label: 'Handling Unit Type' },
        { key: 'packageQty', label: 'Package Qty' },
        { key: 'packageType', label: 'Package Type' },
        { key: 'weight', label: 'Weight' },
        { key: 'goodsDescription', label: 'Commodity Description' },
        { key: 'nmfcNo', label: 'NMFC No.' },
        { key: 'freightClass', label: 'Class' },
      ],
      items,
    ),
    sectionHeading('Signature'),
    infoTable([{ label: 'Shipper Signature / Date', value: fields.shipperSignatureDate }]),
  ];
}

export async function generateDocumentDocx(
  type: DocumentType,
  fields: Record<string, string>,
  items: Record<string, string>[],
): Promise<Buffer> {
  let children: (Paragraph | Table)[];

  switch (type) {
    case DocumentType.CERTIFICATE_OF_ORIGIN:
      children = buildCertificateOfOrigin(fields, items) as (Paragraph | Table)[];
      break;
    case DocumentType.COMMERCIAL_INVOICE:
      children = buildCommercialInvoice(fields, items) as (Paragraph | Table)[];
      break;
    case DocumentType.PACKING_LIST:
      children = buildPackingList(fields, items) as (Paragraph | Table)[];
      break;
    case DocumentType.BILL_OF_LADING:
      children = buildBillOfLading(fields, items) as (Paragraph | Table)[];
      break;
    default:
      throw new Error(`Jenis dokumen ${type} tidak mendukung generate docx`);
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
