import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { generateDocumentDocx } from './docx-generator';
import { CreateDocumentDto } from './dto/create-document.dto';
import { Document, DocumentType } from './entities/document.entity';

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
}

export interface ItemsSchema {
  label: string;
  columns: FieldDef[];
}

interface DocumentSchemaDef {
  label: string;
  category: string;
  fields: FieldDef[];
  itemsSchema?: ItemsSchema;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

const DOCUMENT_SCHEMAS: Record<DocumentType, DocumentSchemaDef> = {
  [DocumentType.SVLK]: {
    label: 'Sistem Verifikasi Legalitas Kayu',
    category: 'Dokumen Legalitas',
    fields: [
      { key: 'companyName', label: 'Nama Perusahaan', required: true },
      { key: 'companyAddress', label: 'Alamat Perusahaan', required: true },
      { key: 'nib', label: 'NIB', required: true },
      { key: 'woodType', label: 'Jenis Kayu', required: true },
      { key: 'woodVolume', label: 'Volume Kayu (m³)', required: true },
      { key: 'certificationBody', label: 'Lembaga Sertifikasi', required: true },
      { key: 'certificationNumber', label: 'Nomor Sertifikasi SVLK', required: true },
    ],
  },
  [DocumentType.PEB]: {
    label: 'Pemberitahuan Ekspor Barang',
    category: 'Dokumen Pabean',
    fields: [
      { key: 'exporterNib', label: 'NIB Eksportir', required: true },
      { key: 'exporterName', label: 'Nama Eksportir', required: true },
      { key: 'exporterAddress', label: 'Alamat Eksportir', required: true },
      { key: 'goodsDescription', label: 'Deskripsi Barang', required: true },
      { key: 'hsCode', label: 'Kode HS', required: true },
      { key: 'quantity', label: 'Jumlah Barang', required: true },
      { key: 'grossWeight', label: 'Berat Kotor (KG)', required: true },
      { key: 'destinationCountry', label: 'Negara Tujuan', required: true },
      { key: 'portOfExport', label: 'Pelabuhan Muat', required: true },
      { key: 'exportDate', label: 'Tanggal Ekspor', required: true },
    ],
  },
  [DocumentType.CERTIFICATE_OF_ORIGIN]: {
    label: 'Certificate of Origin',
    category: 'Dokumen Pabean',
    fields: [
      { key: 'exporterNameAddress', label: '1. Exporter/Seller Name and Address', required: true },
      { key: 'exporterTaxId', label: 'Tax Identification Number', required: true },
      { key: 'blanketPeriodFrom', label: '2. Blanket Period – From (DD/MM/YY)', required: false },
      { key: 'blanketPeriodTo', label: '2. Blanket Period – To (DD/MM/YY)', required: false },
      { key: 'producerNameAddress', label: '3. Supplier/Producer Name and Address', required: false },
      { key: 'importerNameAddress', label: '4. Importer Name and Address', required: true },
      { key: 'certifyingRole', label: 'Menyatakan sebagai (Exporter/Producer/Supplier/Importer)', required: true },
      { key: 'certifyingCompany', label: '8b. Company', required: true },
      { key: 'certifyingName', label: '8c. Name', required: true },
      { key: 'certifyingTitle', label: '8d. Title', required: true },
      { key: 'certifyingDate', label: '8e. Date (DD/MM/YY)', required: true },
      { key: 'certifyingTelephone', label: '8f. Telephone/Facsimile', required: false },
    ],
    itemsSchema: {
      label: 'Description of Good(s)',
      columns: [
        { key: 'goodsDescription', label: '5. Description of Good(s)', required: true },
        { key: 'hsCode', label: '6. HS Tariff Classification (6 digit)', required: true },
        { key: 'countryOfOrigin', label: '7. Country of Origin', required: true },
      ],
    },
  },
  [DocumentType.COMMERCIAL_INVOICE]: {
    label: 'Commercial Invoice',
    category: 'Dokumen Transaksi',
    fields: [
      { key: 'dateOfExportation', label: 'Date of Exportation', required: true },
      { key: 'airwaybillNo', label: 'Airwaybill No.', required: false },
      { key: 'shipperNameAddress', label: 'Shipper/Exporter Name and Address', required: true },
      { key: 'consigneeNameAddress', label: 'Consignee Name and Address', required: true },
      { key: 'importerNameAddress', label: 'Importer (jika berbeda dari Consignee)', required: false },
      { key: 'countryOfExport', label: 'Country of Export', required: true },
      { key: 'countryOfManufacture', label: 'Country of Manufacture', required: true },
      { key: 'countryOfUltimateDestination', label: 'Country of Ultimate Destination', required: true },
      { key: 'signatureName', label: 'Signature of Shipper/Exporter (nama & jabatan)', required: true },
    ],
    itemsSchema: {
      label: 'Full Description of Goods',
      columns: [
        { key: 'noOfPkgs', label: 'No. of Pkgs', required: true },
        { key: 'goodsDescription', label: 'Full Description of Goods', required: true },
        { key: 'qty', label: 'Qty', required: true },
        { key: 'unitValue', label: 'Unit Value', required: true },
        { key: 'totalValue', label: 'Total Value', required: true },
      ],
    },
  },
  [DocumentType.PACKING_LIST]: {
    label: 'Packing List',
    category: 'Dokumen Transaksi',
    fields: [
      { key: 'exporterCompanyAddress', label: 'Exporter – Company Name/Address', required: true },
      { key: 'exporterTaxId', label: 'Exporter – Tax ID#', required: false },
      { key: 'exporterContactName', label: 'Exporter – Contact Name', required: false },
      { key: 'exporterTelephone', label: 'Exporter – Telephone No.', required: false },
      { key: 'exporterEmail', label: 'Exporter – E-Mail', required: false },
      { key: 'exporterCountry', label: 'Exporter – Country/Territory', required: true },
      { key: 'consigneeCompanyAddress', label: 'Consignee – Company Name/Address', required: true },
      { key: 'consigneeTaxId', label: 'Consignee – Tax ID#', required: false },
      { key: 'consigneeContactName', label: 'Consignee – Contact Name', required: false },
      { key: 'consigneeTelephone', label: 'Consignee – Telephone No.', required: false },
      { key: 'consigneeEmail', label: 'Consignee – E-Mail', required: false },
      { key: 'consigneeCountry', label: 'Consignee – Country/Territory', required: true },
      { key: 'shipDate', label: 'Ship Date', required: true },
      { key: 'airWaybillNo', label: 'Air Waybill No. / Tracking No.', required: false },
      { key: 'invoiceNo', label: 'Invoice No.', required: false },
      { key: 'purchaseOrderNo', label: 'Purchase Order No.', required: false },
      { key: 'paymentTerms', label: 'Payment Terms', required: false },
      { key: 'billOfLading', label: 'Bill of Lading', required: false },
      { key: 'packageType', label: 'Package Type', required: false },
      { key: 'specialInstructions', label: 'Special Instructions', required: false },
      { key: 'totalGrossWeight', label: 'Total Gross Weight', required: true },
      { key: 'signatureNameTitleDate', label: 'Signature / Title / Date', required: true },
    ],
    itemsSchema: {
      label: 'Description of Goods',
      columns: [
        { key: 'noOfPackages', label: 'No. of Packages', required: true },
        { key: 'noOfUnits', label: 'No. of Units', required: true },
        { key: 'netWeight', label: 'Net Weight', required: true },
        { key: 'unitOfMeasure', label: 'Unit of Measure', required: true },
        { key: 'goodsDescription', label: 'Description of Goods', required: true },
        { key: 'countryOfManufacture', label: 'Country/Terr. of MFR', required: false },
      ],
    },
  },
  [DocumentType.BILL_OF_LADING]: {
    label: 'Bill of Lading',
    category: 'Dokumen Pengiriman',
    fields: [
      { key: 'bolDate', label: 'Date', required: true },
      { key: 'bolNumber', label: 'Bill of Lading No.', required: true },
      { key: 'shipFromNameAddress', label: 'Ship From – Name and Address', required: true },
      { key: 'shipFromSid', label: 'Ship From – SID#', required: false },
      { key: 'shipToNameAddress', label: 'Ship To – Name and Address', required: true },
      { key: 'shipToLocationNo', label: 'Ship To – Location No.', required: false },
      { key: 'shipToCid', label: 'Ship To – CID#', required: false },
      { key: 'carrierName', label: 'Carrier Name', required: true },
      { key: 'trailerNo', label: 'Trailer No.', required: false },
      { key: 'sealNumbers', label: 'Seal Number(s)', required: false },
      { key: 'scac', label: 'SCAC', required: false },
      { key: 'proNo', label: 'Pro No.', required: false },
      { key: 'thirdPartyBillTo', label: 'Third Party Freight Charges – Bill To', required: false },
      { key: 'freightChargeTerms', label: 'Freight Charge Terms (Prepaid/Collect/3rd Party)', required: true },
      { key: 'specialInstructions', label: 'Special Instructions', required: false },
      { key: 'codAmount', label: 'COD Amount', required: false },
      { key: 'shipperSignatureDate', label: 'Shipper Signature / Date', required: false },
    ],
    itemsSchema: {
      label: 'Commodity Description',
      columns: [
        { key: 'handlingUnitQty', label: 'Handling Unit Qty', required: false },
        { key: 'handlingUnitType', label: 'Handling Unit Type', required: false },
        { key: 'packageQty', label: 'Package Qty', required: true },
        { key: 'packageType', label: 'Package Type', required: true },
        { key: 'weight', label: 'Weight', required: true },
        { key: 'goodsDescription', label: 'Commodity Description', required: true },
        { key: 'nmfcNo', label: 'NMFC No.', required: false },
        { key: 'freightClass', label: 'Class', required: false },
      ],
    },
  },
};

export interface DocumentResponse extends Omit<Document, 'fields' | 'items'> {
  fields: Record<string, string>;
  items: Record<string, string>[] | null;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
  ) {}

  getDocumentTypes() {
    return Object.entries(DOCUMENT_SCHEMAS).map(([type, schema]) => ({
      type,
      label: schema.label,
      category: schema.category,
    }));
  }

  getDocumentSchema(type: DocumentType) {
    const schema = DOCUMENT_SCHEMAS[type];
    if (!schema) throw new NotFoundException(`Document type ${type} not found`);
    return { type, ...schema };
  }

  async createDocument(userId: string, dto: CreateDocumentDto): Promise<DocumentResponse> {
    const schema = DOCUMENT_SCHEMAS[dto.type];
    if (!schema) throw new NotFoundException(`Document type ${dto.type} not found`);

    this.validateRequiredFields(schema, dto.fields);

    let fileUrl: string | null = null;
    let generatedContent: string | null = null;

    if (schema.itemsSchema) {
      if (!dto.items || dto.items.length === 0) {
        throw new BadRequestException(
          `Field "items" wajib diisi minimal 1 baris untuk dokumen ${schema.label}`,
        );
      }
      this.validateItems(schema, dto.items);
      const buffer = await generateDocumentDocx(dto.type, dto.fields, dto.items);
      const dir = join(process.cwd(), 'uploads', 'documents');
      mkdirSync(dir, { recursive: true });
      const filename = `${dto.type.toLowerCase()}-${uuidv4()}.docx`;
      writeFileSync(join(dir, filename), buffer);
      fileUrl = `/uploads/documents/${filename}`;
    } else {
      generatedContent = this.generateLegacyContent(dto.type, dto.fields);
    }

    const doc = this.documentRepo.create({
      userId,
      shipmentId: dto.shipmentId ?? null,
      type: dto.type,
      fields: JSON.stringify(dto.fields),
      items: dto.items ? JSON.stringify(dto.items) : null,
      generatedContent,
      fileUrl,
      status: 'generated',
    });
    const saved = await this.documentRepo.save(doc);
    return this.toResponse(saved);
  }

  async getUserDocuments(
    userId: string,
    shipmentId?: string,
  ): Promise<DocumentResponse[]> {
    const docs = await this.documentRepo.find({
      where: shipmentId ? { userId, shipmentId } : { userId },
      order: { createdAt: 'DESC' },
    });
    return docs.map((doc) => this.toResponse(doc));
  }

  async getDocumentById(id: string, userId: string): Promise<DocumentResponse> {
    const doc = await this.documentRepo.findOne({ where: { id, userId } });
    if (!doc) throw new NotFoundException('Document not found');
    return this.toResponse(doc);
  }

  private toResponse(doc: Document): DocumentResponse {
    return {
      ...doc,
      fields: JSON.parse(doc.fields) as Record<string, string>,
      items: doc.items ? (JSON.parse(doc.items) as Record<string, string>[]) : null,
    };
  }

  private validateRequiredFields(
    schema: DocumentSchemaDef,
    fields: Record<string, string>,
  ): void {
    const missing = schema.fields
      .filter((f) => f.required && isBlank(fields?.[f.key]))
      .map((f) => f.label);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Field wajib belum diisi: ${missing.join(', ')}`,
      );
    }
  }

  private validateItems(
    schema: DocumentSchemaDef,
    items: Record<string, string>[],
  ): void {
    if (!schema.itemsSchema) return;
    items.forEach((item, idx) => {
      const missing = schema.itemsSchema!.columns
        .filter((c) => c.required && isBlank(item?.[c.key]))
        .map((c) => c.label);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Baris ${idx + 1} pada "${schema.itemsSchema!.label}" belum lengkap: ${missing.join(', ')}`,
        );
      }
    });
  }

  private generateLegacyContent(type: DocumentType, fields: Record<string, string>): string {
    const now = new Date().toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    switch (type) {
      case DocumentType.SVLK:
        return `
SERTIFIKAT SISTEM VERIFIKASI LEGALITAS KAYU (SVLK)
====================================================
Nomor Sertifikat : ${fields.certificationNumber || '-'}
Tanggal Diterbitkan: ${now}

PEMEGANG SERTIFIKAT
Nama Perusahaan  : ${fields.companyName || '-'}
Alamat           : ${fields.companyAddress || '-'}
NIB              : ${fields.nib || '-'}

LINGKUP SERTIFIKASI
Jenis Kayu       : ${fields.woodType || '-'}
Volume           : ${fields.woodVolume || '-'} m³

LEMBAGA VERIFIKASI
${fields.certificationBody || '-'}

Sertifikat ini menyatakan bahwa produk kayu tersebut memenuhi standar legalitas kayu Indonesia.
        `.trim();

      case DocumentType.PEB:
        return `
PEMBERITAHUAN EKSPOR BARANG (PEB)
===================================
Tanggal PEB      : ${fields.exportDate || now}

DATA EKSPORTIR
NIB              : ${fields.exporterNib || '-'}
Nama Eksportir   : ${fields.exporterName || '-'}
Alamat           : ${fields.exporterAddress || '-'}

DATA BARANG
Deskripsi        : ${fields.goodsDescription || '-'}
Kode HS          : ${fields.hsCode || '-'}
Jumlah           : ${fields.quantity || '-'}
Berat Kotor      : ${fields.grossWeight || '-'} KG

DATA PENGIRIMAN
Negara Tujuan    : ${fields.destinationCountry || '-'}
Pelabuhan Muat   : ${fields.portOfExport || '-'}
Tanggal Ekspor   : ${fields.exportDate || '-'}
        `.trim();

      default:
        return 'Dokumen berhasil dibuat.';
    }
  }
}
