import { DocumentAssistantService } from './document-assistant.service';
import {
  Document,
  DocumentOrigin,
  DocumentType,
} from './entities/document.entity';
import { ExtractedField } from './entities/extracted-field.entity';
import { Shipment } from '../shipments/entities/shipment.entity';
import { User } from '../users/entities/user.entity';
import { ShipmentFact } from './entities/shipment-fact.entity';

describe('DocumentAssistantService', () => {
  const shipment = {
    id: 'shipment-1',
    shipmentCode: 'KUB-24084',
    userId: 'user-1',
    originCity: 'Jakarta',
    originPort: 'Tanjung Priok',
    destinationCountry: 'Japan',
    destinationPort: 'Tokyo',
    cargoReadyDate: '2026-08-24',
    cbm: 1.8,
    containerId: null,
    exporterName: 'Adi Wijaya',
    exporterCompany: 'Batik Nusantara',
    exporterAddress: 'Jl. Industri 5, Bandung',
    exporterEmail: 'adi@example.com',
    consigneeName: 'Aiko Tanaka',
    consigneeCompany: 'Sakura Textile Co.',
    consigneeAddress: 'Aomi, Tokyo',
    consigneeEmail: 'aiko@example.jp',
    productDescription: 'Batik Fabric',
    productHsCode: '520819',
    productCategory: 'Textile',
    productQuantity: 120,
    productQuantityUnit: 'pcs',
    productGrossWeight: 180,
    productNetWeight: 165,
    productWeightUnit: 'kg',
    productPackaging: 'Cartons',
    invoiceNumber: 'INV-KUB-24084-01',
    invoiceDate: '2026-08-22',
    countryOfOrigin: 'Indonesia',
    additionalHandling: null,
  } as Shipment;

  const user = {
    id: 'user-1',
    name: 'Adi Wijaya',
    businessName: 'Batik Nusantara',
    businessAddress: 'Jl. Industri 5, Bandung',
    nib: '1234567890123456',
  } as User;

  const document = {
    id: 'document-1',
    userId: 'user-1',
    shipmentId: 'shipment-1',
    type: DocumentType.PACKING_LIST,
    documentOrigin: DocumentOrigin.UPLOADED,
    originalFileName: 'Packing_List.pdf',
    parserName: 'docling',
    classificationConfidence: 0.9,
    classificationMethod: 'rules',
    hasTextLayer: true,
  } as Document;

  const grossWeightField = {
    id: 'field-1',
    documentId: document.id,
    document,
    field: 'gross_weight',
    value: '185',
    unit: 'kg',
    confidence: 0.97,
    pageNumber: 1,
    rawText: 'Gross Weight: 185 KG',
    boundingBox: '[10,20,100,40]',
    isCorrected: false,
  } as ExtractedField;

  const shipmentRepo = { findOne: jest.fn().mockResolvedValue(shipment) };
  const userRepo = { findOneBy: jest.fn().mockResolvedValue(user) };
  const documentRepo = { find: jest.fn().mockResolvedValue([document]) };
  Object.assign(documentRepo, {
    save: jest.fn((value: Document) => Promise.resolve(value)),
  });
  const fieldRepo = {
    find: jest.fn().mockResolvedValue([grossWeightField]),
    findOne: jest.fn().mockResolvedValue(grossWeightField),
  };
  const factRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value: Partial<ShipmentFact>) => value as ShipmentFact),
    save: jest.fn((value: ShipmentFact) => Promise.resolve(value)),
  };
  const containerRepo = { findOneBy: jest.fn().mockResolvedValue(null) };
  const vesselRepo = { findOneBy: jest.fn().mockResolvedValue(null) };
  const documentsService = { createDocument: jest.fn() };

  const service = new DocumentAssistantService(
    shipmentRepo as never,
    userRepo as never,
    documentRepo as never,
    fieldRepo as never,
    factRepo as never,
    containerRepo as never,
    vesselRepo as never,
    documentsService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('detects a cross-document conflict without choosing a value', async () => {
    const overview = await service.getOverview(shipment.id, user.id);

    expect(overview.crossDocumentValidation.status).toBe('conflict');
    const conflict = overview.crossDocumentValidation.conflicts.find(
      (entry) => entry.field === 'gross_weight',
    );
    expect(conflict).toBeDefined();
    expect(conflict?.candidates.map((candidate) => candidate.value)).toEqual(
      expect.arrayContaining(['180', '185']),
    );
  });

  it('returns useful field provenance while keeping parser data in debug', async () => {
    const validation = await service.validateUploadedDocument(
      shipment.id,
      document.id,
      user.id,
    );
    const field = validation.fields.find(
      (entry) => entry.canonicalKey === 'gross_weight',
    );

    expect(field).toMatchObject({
      value: '185',
      unit: 'kg',
      status: 'conflict',
      confidence: 0.97,
      sources: [
        expect.objectContaining({
          fileName: 'Packing_List.pdf',
          page: 1,
          rawText: 'Gross Weight: 185 KG',
        }),
      ],
    });
    expect(validation.debug).toMatchObject({ parser: 'docling' });
    expect(documentRepo.save).toHaveBeenCalledWith(document);
    expect(document.lastValidatedAt).toBeInstanceOf(Date);
    expect(document).toMatchObject({ validationCount: 1, status: 'conflict' });
  });

  it('persists an explicit user conflict decision as a verified fact', async () => {
    await service.resolveConflict(shipment.id, user.id, {
      field: 'gross_weight',
      value: '180',
      unit: 'kg',
      sourceDocumentId: document.id,
    });

    expect(factRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'gross_weight',
        value: '180',
        unit: 'kg',
        confidence: 1,
        isUserVerified: true,
      }),
    );
  });

  it('treats a user-confirmed canonical value as the resolved result', async () => {
    factRepo.find.mockResolvedValueOnce([
      {
        shipmentId: shipment.id,
        userId: user.id,
        field: 'gross_weight',
        value: '180',
        unit: 'kg',
        confidence: 1,
        isUserVerified: true,
      },
    ]);

    const validation = await service.validateUploadedDocument(
      shipment.id,
      document.id,
      user.id,
    );
    const field = validation.fields.find(
      (entry) => entry.canonicalKey === 'gross_weight',
    );

    expect(field).toMatchObject({
      value: '180',
      status: 'valid',
      conflictCandidates: undefined,
      sources: [
        expect.objectContaining({ label: 'User Confirmed Value' }),
        expect.objectContaining({ fileName: 'Packing_List.pdf' }),
      ],
    });
  });

  it('returns one canonical field with selectable candidates for duplicate template aliases', async () => {
    const invoiceDocument = {
      ...document,
      id: 'invoice-document',
      type: DocumentType.COMMERCIAL_INVOICE,
      originalFileName: 'Commercial_Invoice.pdf',
    } as Document;
    const originCountryField = {
      id: 'origin-country-field',
      documentId: invoiceDocument.id,
      document: invoiceDocument,
      field: 'origin_country',
      value: 'Vietnam',
      confidence: 0.91,
      pageNumber: 1,
      isCorrected: false,
    } as ExtractedField;
    documentRepo.find.mockResolvedValueOnce([invoiceDocument]);
    fieldRepo.find.mockResolvedValueOnce([originCountryField]);

    const readiness = await service.getReadiness(
      shipment.id,
      user.id,
      DocumentType.COMMERCIAL_INVOICE,
    );
    const originFields = readiness.fields.filter(
      (field) => field.canonicalKey === 'origin_country',
    );
    const consigneeFields = readiness.fields.filter(
      (field) => field.canonicalKey === 'consignee_name_address',
    );

    expect(originFields).toHaveLength(1);
    expect(originFields[0]).toMatchObject({
      key: 'origin_country',
      status: 'conflict',
    });
    expect(originFields[0].documentKeys).toEqual(
      expect.arrayContaining(['countryOfExport', 'countryOfManufacture']),
    );
    expect(
      originFields[0].conflictCandidates?.map((candidate) => candidate.value),
    ).toEqual(expect.arrayContaining(['Indonesia', 'Vietnam']));
    expect(consigneeFields).toHaveLength(1);
    expect(consigneeFields[0].documentKeys).toEqual(
      expect.arrayContaining(['consigneeNameAddress', 'importerNameAddress']),
    );
  });
});
