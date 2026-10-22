import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { Document, DocumentType } from './entities/document.entity';
import { DocumentsService } from './documents.service';
import { User } from '../users/entities/user.entity';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'documents');
const EXISTING_UPLOADS = new Set(
  existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : [],
);

const VALID_FIELDS: Record<DocumentType, Record<string, string>> = {
  [DocumentType.SVLK]: {
    companyName: 'Batik Nusantara',
    companyAddress: 'Jl. Industri No. 5, Bandung',
    nib: '1234567890123456',
    woodType: 'Jati',
    woodVolume: '12',
    certificationBody: 'LVLK PT ABC',
    certificationNumber: 'SVLK-0001',
  },
  [DocumentType.PEB]: {
    exporterNib: '1234567890123456',
    exporterName: 'Batik Nusantara',
    exporterAddress: 'Jl. Industri No. 5, Bandung',
    goodsDescription: 'Batik Fabric',
    hsCode: '520819',
    quantity: '100',
    grossWeight: '50',
    destinationCountry: 'Japan',
    portOfExport: 'Tanjung Priok',
    exportDate: '2026-08-01',
  },
  [DocumentType.CERTIFICATE_OF_ORIGIN]: {
    exporterNameAddress: 'Batik Nusantara, Bandung',
    exporterTaxId: '1234567890123456',
    importerNameAddress: 'Tokyo Trading Co., Tokyo',
    certifyingRole: 'Exporter',
    certifyingCompany: 'Batik Nusantara',
    certifyingName: 'Adi Wijaya',
    certifyingTitle: 'Owner',
    certifyingDate: '01/08/26',
  },
  [DocumentType.COMMERCIAL_INVOICE]: {
    dateOfExportation: '01/08/26',
    invoiceNumber: 'INV-2026-001',
    shipperNameAddress: 'Batik Nusantara, Bandung',
    consigneeNameAddress: 'Tokyo Trading Co., Tokyo',
    countryOfExport: 'Indonesia',
    countryOfManufacture: 'Indonesia',
    countryOfUltimateDestination: 'Japan',
    signatureName: 'Adi Wijaya, Owner',
  },
  [DocumentType.PACKING_LIST]: {
    exporterCompanyAddress: 'Batik Nusantara, Bandung',
    exporterCountry: 'Indonesia',
    consigneeCompanyAddress: 'Tokyo Trading Co., Tokyo',
    consigneeCountry: 'Japan',
    shipDate: '01/08/26',
    hsCode: '520819',
    totalVolume: '1.8',
    totalGrossWeight: '50 KG',
    signatureNameTitleDate: 'Adi Wijaya, Owner, 01/08/26',
  },
  [DocumentType.BILL_OF_LADING]: {
    bolDate: '01/08/26',
    bolNumber: 'BOL-0001',
    shipFromNameAddress: 'Batik Nusantara, Bandung',
    shipToNameAddress: 'Tokyo Trading Co., Tokyo',
    carrierName: 'Maersk',
    portOfLoading: 'Tanjung Priok',
    portOfDischarge: 'Tokyo',
    measurementCbm: '1.8',
    freightChargeTerms: 'Prepaid',
  },
};

const VALID_ITEMS: Partial<Record<DocumentType, Record<string, string>[]>> = {
  [DocumentType.CERTIFICATE_OF_ORIGIN]: [
    {
      goodsDescription: 'Batik Fabric',
      hsCode: '520819',
      countryOfOrigin: 'Indonesia',
    },
  ],
  [DocumentType.COMMERCIAL_INVOICE]: [
    {
      noOfPkgs: '1',
      goodsDescription: 'Batik Fabric',
      qty: '100',
      unitValue: '5',
      totalValue: '500',
    },
  ],
  [DocumentType.PACKING_LIST]: [
    {
      noOfPackages: '1',
      noOfUnits: '100',
      netWeight: '48',
      unitOfMeasure: 'KG',
      goodsDescription: 'Batik Fabric',
    },
  ],
  [DocumentType.BILL_OF_LADING]: [
    {
      packageQty: '1',
      packageType: 'Box',
      weight: '50',
      goodsDescription: 'Batik Fabric',
    },
  ],
};

describe('DocumentsService', () => {
  let service: DocumentsService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Document, User],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([Document, User]),
      ],
      providers: [DocumentsService],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);

    const userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    await userRepo.insert([
      {
        id: 'user-1',
        name: 'Adi Wijaya',
        email: 'adi@umkm.com',
        password: 'hashed',
        businessName: 'Batik Nusantara',
        businessType: 'Kerajinan Tekstil',
        ownerAddress: 'Jl. Merdeka No. 10, Jakarta',
        businessAddress: 'Jl. Industri No. 5, Bandung',
      },
      {
        id: 'user-2',
        name: 'Sri Rahayu',
        email: 'sri@umkm.com',
        password: 'hashed',
        businessName: 'Kopi Nusantara',
        businessType: 'Makanan & Minuman',
        ownerAddress: 'Jl. Merdeka No. 20, Jakarta',
        businessAddress: 'Jl. Industri No. 6, Bandung',
      },
    ]);
  });

  afterAll(async () => {
    await module.close();
    if (existsSync(UPLOAD_DIR)) {
      for (const fileName of readdirSync(UPLOAD_DIR)) {
        if (!EXISTING_UPLOADS.has(fileName)) {
          unlinkSync(join(UPLOAD_DIR, fileName));
        }
      }
    }
  });

  it('lists all 6 document types', () => {
    const types = service.getDocumentTypes();
    expect(types).toHaveLength(6);
    expect(types.map((t) => t.type)).toEqual(
      expect.arrayContaining(Object.values(DocumentType)),
    );
  });

  it('rejects creation when a required field is missing', async () => {
    await expect(
      service.createDocument('user-1', {
        type: DocumentType.SVLK,
        fields: { companyName: 'Batik Nusantara' },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects docx documents missing the items array', async () => {
    await expect(
      service.createDocument('user-1', {
        type: DocumentType.PACKING_LIST,
        fields: VALID_FIELDS[DocumentType.PACKING_LIST],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects docx documents with an incomplete item row', async () => {
    await expect(
      service.createDocument('user-1', {
        type: DocumentType.PACKING_LIST,
        fields: VALID_FIELDS[DocumentType.PACKING_LIST],
        items: [{ noOfPackages: '1' }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([
    DocumentType.CERTIFICATE_OF_ORIGIN,
    DocumentType.COMMERCIAL_INVOICE,
    DocumentType.PACKING_LIST,
    DocumentType.BILL_OF_LADING,
  ])(
    'generates real PDF and DOCX drafts for %s and persists them',
    async (type) => {
      const created = await service.createDocument('user-1', {
        type,
        fields: VALID_FIELDS[type],
        items: VALID_ITEMS[type],
      });

      expect(created.fileUrl).toMatch(/^\/uploads\/documents\/.+\.pdf$/);
      expect(created.docxFileUrl).toMatch(/^\/uploads\/documents\/.+\.docx$/);
      expect(created.generatedContent).toBeNull();
      expect(created.status).toBe('draft_generated');
      expect(created.documentOrigin).toBe('generated');
      expect(created.templateVersion).toBe('1.0.0');
      expect(created.fields).toEqual(VALID_FIELDS[type]);
      expect(created.items).toEqual(VALID_ITEMS[type]);

      const absolutePath = join(
        process.cwd(),
        created.fileUrl!.replace(/^\//, ''),
      );
      expect(existsSync(absolutePath)).toBe(true);
      const pdfBuffer = readFileSync(absolutePath);
      expect(pdfBuffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(statSync(absolutePath).size).toBeGreaterThan(1000);

      const docxPath = join(
        process.cwd(),
        created.docxFileUrl!.replace(/^\//, ''),
      );
      const docxBuffer = readFileSync(docxPath);
      expect(docxBuffer.subarray(0, 4).toString('hex')).toBe('504b0304');
      expect(statSync(docxPath).size).toBeGreaterThan(1000);

      const fetched = await service.getDocumentById(created.id, 'user-1');
      expect(fetched.type).toBe(type);
      expect(fetched.fields).toEqual(VALID_FIELDS[type]);
    },
  );

  it('generates a PDF draft and keeps legacy preview content for SVLK', async () => {
    const created = await service.createDocument('user-1', {
      type: DocumentType.SVLK,
      fields: VALID_FIELDS[DocumentType.SVLK],
    });

    expect(created.fileUrl).toMatch(/^\/uploads\/documents\/.+\.pdf$/);
    expect(created.docxFileUrl).toBeNull();
    expect(created.generatedContent).toContain(
      'SERTIFIKAT SISTEM VERIFIKASI LEGALITAS KAYU',
    );
  });

  it("lists only the requesting user's documents, newest first", async () => {
    await service.createDocument('user-2', {
      type: DocumentType.PEB,
      fields: VALID_FIELDS[DocumentType.PEB],
    });

    const userDocs = await service.getUserDocuments('user-2');
    expect(userDocs).toHaveLength(1);
    expect(userDocs[0].userId).toBe('user-2');

    const otherUserDocs = await service.getUserDocuments('user-1');
    expect(otherUserDocs.every((d) => d.userId === 'user-1')).toBe(true);
  });
});
