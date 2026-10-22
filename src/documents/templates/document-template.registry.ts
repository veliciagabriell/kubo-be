import { Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'path';
import { DocumentType } from '../entities/document.entity';
import { mapBillOfLading } from '../mappings/bill-of-lading.mapping';
import { mapCertificateOfOrigin } from '../mappings/certificate-of-origin.mapping';
import { mapCommercialInvoice } from '../mappings/commercial-invoice.mapping';
import { DocumentMapper } from '../mappings/document-mapping.types';
import { mapPackingList } from '../mappings/packing-list.mapping';

export type FieldRequirement =
  | 'required_before_generation'
  | 'required_before_verification'
  | 'optional'
  | 'provided_by_forwarder';

export interface TemplateFieldPolicy {
  key: string;
  label: string;
  requirement: FieldRequirement;
  draftPlaceholder?: string;
}

export interface TableBinding {
  table: number;
  row: number;
  columns: string[];
}

export interface DocumentTemplateDefinition {
  type: DocumentType;
  label: string;
  templateFileName: string;
  templateFormat: 'docx';
  version: string;
  mapper: DocumentMapper;
  fields: TemplateFieldPolicy[];
  cellBindings: Record<string, { table: number; row: number; column: number }>;
  itemTable: TableBinding;
  requiredItemFields: Array<{ key: string; label: string }>;
}

const required = (key: string, label: string): TemplateFieldPolicy => ({
  key,
  label,
  requirement: 'required_before_generation',
});
const optional = (key: string, label: string): TemplateFieldPolicy => ({
  key,
  label,
  requirement: 'optional',
});
const forwarder = (key: string, label: string): TemplateFieldPolicy => ({
  key,
  label,
  requirement: 'provided_by_forwarder',
  draftPlaceholder: 'TBC',
});

const definitions: DocumentTemplateDefinition[] = [
  {
    type: DocumentType.BILL_OF_LADING,
    label: 'Bill of Lading',
    templateFileName: 'bill_of_lading.template.docx',
    templateFormat: 'docx',
    version: '2.0.0',
    mapper: mapBillOfLading,
    fields: [
      required('bolDate', 'Date'),
      forwarder('bolNumber', 'Bill of Lading No.'),
      required('shipFromNameAddress', 'Ship From – Name and Address'),
      optional('shipFromSid', 'Ship From – SID#'),
      required('shipToNameAddress', 'Ship To – Name and Address'),
      optional('shipToLocationNo', 'Ship To – Location No.'),
      optional('shipToCid', 'Ship To – CID#'),
      forwarder('carrierName', 'Carrier Name'),
      forwarder('containerNumber', 'Container Number'),
      forwarder('sealNumbers', 'Seal Number(s)'),
      forwarder('voyageNumber', 'Voyage Number'),
      required('portOfLoading', 'Port of Loading'),
      required('portOfDischarge', 'Port of Discharge'),
      required('measurementCbm', 'Measurement / CBM'),
      forwarder('freightChargeTerms', 'Freight Charge Terms'),
    ],
    cellBindings: {
      bolDate: { table: 0, row: 0, column: 1 },
      bolNumber: { table: 0, row: 1, column: 1 },
      shipFromNameAddress: { table: 1, row: 0, column: 1 },
      shipFromSid: { table: 1, row: 1, column: 1 },
      shipToNameAddress: { table: 2, row: 0, column: 1 },
      shipToLocationNo: { table: 2, row: 1, column: 1 },
      shipToCid: { table: 2, row: 2, column: 1 },
      carrierName: { table: 3, row: 0, column: 1 },
      containerNumber: { table: 3, row: 1, column: 1 },
      sealNumbers: { table: 3, row: 2, column: 1 },
      scac: { table: 3, row: 3, column: 1 },
      voyageNumber: { table: 3, row: 4, column: 1 },
      thirdPartyBillTo: { table: 4, row: 0, column: 1 },
      freightChargeTerms: { table: 4, row: 1, column: 1 },
      codAmount: { table: 4, row: 2, column: 1 },
      specialInstructions: { table: 4, row: 3, column: 1 },
      shipperSignatureDate: { table: 6, row: 0, column: 1 },
    },
    itemTable: {
      table: 5,
      row: 1,
      columns: [
        'handlingUnitQty',
        'handlingUnitType',
        'packageQty',
        'packageType',
        'weight',
        'goodsDescription',
        'nmfcNo',
        'freightClass',
      ],
    },
    requiredItemFields: [
      { key: 'packageQty', label: 'Package Quantity' },
      { key: 'packageType', label: 'Package Type' },
      { key: 'weight', label: 'Gross Weight' },
      { key: 'goodsDescription', label: 'Commodity Description' },
    ],
  },
  {
    type: DocumentType.COMMERCIAL_INVOICE,
    label: 'Commercial Invoice',
    templateFileName: 'commercial_invoice.template.docx',
    templateFormat: 'docx',
    version: '2.0.0',
    mapper: mapCommercialInvoice,
    fields: [
      required('dateOfExportation', 'Date of Exportation'),
      required('invoiceNumber', 'Invoice Number'),
      required('shipperNameAddress', 'Shipper / Exporter'),
      required('consigneeNameAddress', 'Consignee'),
      required('countryOfExport', 'Country of Export'),
      required('countryOfManufacture', 'Country of Manufacture'),
      required(
        'countryOfUltimateDestination',
        'Country of Ultimate Destination',
      ),
      required('totalInvoiceValue', 'Total Invoice Value'),
    ],
    cellBindings: {
      dateOfExportation: { table: 0, row: 0, column: 1 },
      invoiceNumber: { table: 0, row: 1, column: 1 },
      airwaybillNo: { table: 0, row: 2, column: 1 },
      shipperNameAddress: { table: 1, row: 0, column: 1 },
      consigneeNameAddress: { table: 2, row: 0, column: 1 },
      importerNameAddress: { table: 3, row: 0, column: 1 },
      countryOfExport: { table: 4, row: 0, column: 1 },
      countryOfManufacture: { table: 4, row: 1, column: 1 },
      countryOfUltimateDestination: { table: 4, row: 2, column: 1 },
      totalInvoiceValue: { table: 6, row: 0, column: 1 },
      signatureName: { table: 7, row: 0, column: 1 },
    },
    itemTable: {
      table: 5,
      row: 1,
      columns: [
        'noOfPkgs',
        'goodsDescription',
        'qty',
        'unitValue',
        'totalValue',
      ],
    },
    requiredItemFields: [
      { key: 'noOfPkgs', label: 'Number of Packages' },
      { key: 'goodsDescription', label: 'Goods Description' },
      { key: 'qty', label: 'Quantity' },
      { key: 'unitValue', label: 'Unit Value' },
      { key: 'totalValue', label: 'Total Value' },
    ],
  },
  {
    type: DocumentType.PACKING_LIST,
    label: 'Packing List',
    templateFileName: 'packing_list.template.docx',
    templateFormat: 'docx',
    version: '2.0.0',
    mapper: mapPackingList,
    fields: [
      required('exporterCompanyAddress', 'Exporter Company Name / Address'),
      required('exporterCountry', 'Exporter Country'),
      required('consigneeCompanyAddress', 'Consignee Company Name / Address'),
      required('consigneeCountry', 'Consignee Country'),
      required('shipDate', 'Ship Date'),
      required('packageType', 'Package Type'),
      required('totalGrossWeight', 'Total Gross Weight'),
    ],
    cellBindings: {
      exporterCompanyAddress: { table: 0, row: 0, column: 1 },
      exporterTaxId: { table: 0, row: 1, column: 1 },
      exporterContactName: { table: 0, row: 2, column: 1 },
      exporterTelephone: { table: 0, row: 3, column: 1 },
      exporterEmail: { table: 0, row: 4, column: 1 },
      exporterCountry: { table: 0, row: 5, column: 1 },
      consigneeCompanyAddress: { table: 1, row: 0, column: 1 },
      consigneeTaxId: { table: 1, row: 1, column: 1 },
      consigneeContactName: { table: 1, row: 2, column: 1 },
      consigneeTelephone: { table: 1, row: 3, column: 1 },
      consigneeEmail: { table: 1, row: 4, column: 1 },
      consigneeCountry: { table: 1, row: 5, column: 1 },
      shipDate: { table: 2, row: 0, column: 1 },
      airWaybillNo: { table: 2, row: 1, column: 1 },
      invoiceNo: { table: 2, row: 2, column: 1 },
      purchaseOrderNo: { table: 2, row: 3, column: 1 },
      paymentTerms: { table: 2, row: 4, column: 1 },
      billOfLading: { table: 2, row: 5, column: 1 },
      packageType: { table: 2, row: 6, column: 1 },
      specialInstructions: { table: 2, row: 7, column: 1 },
      totalGrossWeight: { table: 4, row: 0, column: 1 },
      signatureNameTitleDate: { table: 5, row: 0, column: 1 },
    },
    itemTable: {
      table: 3,
      row: 1,
      columns: [
        'noOfPackages',
        'noOfUnits',
        'netWeight',
        'unitOfMeasure',
        'goodsDescription',
        'countryOfManufacture',
      ],
    },
    requiredItemFields: [
      { key: 'noOfPackages', label: 'Number of Packages' },
      { key: 'noOfUnits', label: 'Number of Units' },
      { key: 'netWeight', label: 'Net Weight' },
      { key: 'unitOfMeasure', label: 'Unit of Measure' },
      { key: 'goodsDescription', label: 'Goods Description' },
    ],
  },
  {
    type: DocumentType.CERTIFICATE_OF_ORIGIN,
    label: 'Certificate of Origin',
    templateFileName: 'certificate_of_origin.template.docx',
    templateFormat: 'docx',
    version: '2.0.0',
    mapper: mapCertificateOfOrigin,
    fields: [
      required('exporterNameAddress', 'Exporter / Seller'),
      required('exporterTaxId', 'Tax Identification Number'),
      required('importerNameAddress', 'Importer'),
      required('certifyingCompany', 'Certifying Company'),
      required('certifyingName', 'Certifying Person'),
      required('certifyingDate', 'Certification Date'),
    ],
    cellBindings: {
      exporterNameAddress: { table: 0, row: 0, column: 1 },
      exporterTaxId: { table: 0, row: 1, column: 1 },
      blanketPeriodFrom: { table: 1, row: 0, column: 1 },
      blanketPeriodTo: { table: 1, row: 1, column: 1 },
      producerNameAddress: { table: 2, row: 0, column: 1 },
      importerNameAddress: { table: 3, row: 0, column: 1 },
      certifyingRole: { table: 5, row: 0, column: 1 },
      certifyingCompany: { table: 5, row: 1, column: 1 },
      certifyingName: { table: 5, row: 2, column: 1 },
      certifyingTitle: { table: 5, row: 3, column: 1 },
      certifyingDate: { table: 5, row: 4, column: 1 },
      certifyingTelephone: { table: 5, row: 5, column: 1 },
    },
    itemTable: {
      table: 4,
      row: 1,
      columns: ['goodsDescription', 'hsCode', 'countryOfOrigin'],
    },
    requiredItemFields: [
      { key: 'goodsDescription', label: 'Description of Goods' },
      { key: 'hsCode', label: 'HS Tariff Classification' },
      { key: 'countryOfOrigin', label: 'Country of Origin' },
    ],
  },
];

@Injectable()
export class DocumentTemplateRegistry {
  get(type: DocumentType): DocumentTemplateDefinition {
    const definition = definitions.find((item) => item.type === type);
    if (!definition)
      throw new NotFoundException(`No template registered for ${type}`);
    return definition;
  }

  resolvePath(definition: DocumentTemplateDefinition): string {
    const directory =
      process.env.DOCUMENT_TEMPLATE_DIR ??
      join(process.cwd(), 'uploads', 'documents', 'templates');
    return join(directory, definition.templateFileName);
  }

  supports(type: DocumentType): boolean {
    return definitions.some((item) => item.type === type);
  }
}
