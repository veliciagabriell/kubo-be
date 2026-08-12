import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Container } from '../matching/entities/container.entity';
import { Shipment } from '../shipments/entities/shipment.entity';
import { User } from '../users/entities/user.entity';
import { Vessel } from '../vessels/entities/vessel.entity';
import { GenerateDocumentDraftDto } from './dto/generate-document-draft.dto';
import { ResolveDocumentConflictDto } from './dto/resolve-document-conflict.dto';
import {
  ConflictCandidate,
  DocumentField,
  DocumentReadiness,
  FieldSource,
  FieldSourceType,
  FieldValidationStatus,
} from './document-assistant.types';
import { DOCUMENT_SCHEMAS, DocumentsService } from './documents.service';
import {
  Document,
  DocumentOrigin,
  DocumentType,
} from './entities/document.entity';
import { ExtractedField } from './entities/extracted-field.entity';
import { ShipmentFact } from './entities/shipment-fact.entity';

interface FieldMapping {
  canonicalKey: string;
  sourcePriority?: FieldSourceType[];
  externalMessage?: string;
  externalPlaceholder?: string;
  confirmWhenShipmentOnly?: boolean;
}

interface AssistantDefinition {
  fields: Record<string, FieldMapping>;
  items?: Record<string, FieldMapping>;
}

interface KnowledgeCandidate {
  key: string;
  value: string;
  normalizedValue: string;
  unit?: string;
  confidence?: number;
  verified: boolean;
  source: FieldSource;
}

interface ShipmentKnowledge {
  shipment: Shipment;
  user: User;
  documents: Document[];
  candidates: Map<string, KnowledgeCandidate[]>;
}

const DEFAULT_PRIORITY: FieldSourceType[] = [
  'uploaded_document',
  'company_profile',
  'shipment',
  'cargo',
  'container_match',
  'vessel_match',
  'generated_document',
  'freight_forwarder',
];

const external = (canonicalKey: string, message: string): FieldMapping => ({
  canonicalKey,
  externalMessage: message,
});

const DEFINITIONS: Record<DocumentType, AssistantDefinition> = {
  [DocumentType.SVLK]: {
    fields: {
      companyName: { canonicalKey: 'exporter_company' },
      companyAddress: { canonicalKey: 'exporter_address' },
      nib: { canonicalKey: 'nib' },
      woodType: { canonicalKey: 'product_category' },
      woodVolume: { canonicalKey: 'cbm' },
      certificationBody: external(
        'svlk_certification_body',
        'Waiting for certification body',
      ),
      certificationNumber: external(
        'svlk_certification_number',
        'Available after official verification',
      ),
    },
  },
  [DocumentType.PEB]: {
    fields: {
      exporterNib: { canonicalKey: 'nib' },
      exporterName: { canonicalKey: 'exporter_company' },
      exporterAddress: { canonicalKey: 'exporter_address' },
      goodsDescription: { canonicalKey: 'product_description' },
      hsCode: {
        canonicalKey: 'hs_code',
        confirmWhenShipmentOnly: true,
      },
      quantity: { canonicalKey: 'quantity' },
      grossWeight: { canonicalKey: 'gross_weight' },
      destinationCountry: { canonicalKey: 'destination_country' },
      portOfExport: { canonicalKey: 'port_of_loading' },
      exportDate: { canonicalKey: 'cargo_ready_date' },
    },
  },
  [DocumentType.CERTIFICATE_OF_ORIGIN]: {
    fields: {
      exporterNameAddress: { canonicalKey: 'exporter_name_address' },
      exporterTaxId: { canonicalKey: 'nib' },
      blanketPeriodFrom: { canonicalKey: 'blanket_period_from' },
      blanketPeriodTo: { canonicalKey: 'blanket_period_to' },
      producerNameAddress: { canonicalKey: 'producer_name_address' },
      importerNameAddress: { canonicalKey: 'consignee_name_address' },
      certifyingRole: { canonicalKey: 'certifying_role' },
      certifyingCompany: { canonicalKey: 'exporter_company' },
      certifyingName: { canonicalKey: 'exporter_name' },
      certifyingTitle: { canonicalKey: 'certifying_title' },
      certifyingDate: { canonicalKey: 'cargo_ready_date' },
      certifyingTelephone: { canonicalKey: 'exporter_telephone' },
    },
    items: {
      goodsDescription: { canonicalKey: 'product_description' },
      hsCode: { canonicalKey: 'hs_code', confirmWhenShipmentOnly: true },
      countryOfOrigin: { canonicalKey: 'origin_country' },
    },
  },
  [DocumentType.COMMERCIAL_INVOICE]: {
    fields: {
      dateOfExportation: { canonicalKey: 'invoice_date' },
      invoiceNumber: { canonicalKey: 'invoice_number' },
      airwaybillNo: external('airwaybill_number', 'Available after booking'),
      shipperNameAddress: { canonicalKey: 'exporter_name_address' },
      consigneeNameAddress: { canonicalKey: 'consignee_name_address' },
      importerNameAddress: { canonicalKey: 'consignee_name_address' },
      countryOfExport: { canonicalKey: 'origin_country' },
      countryOfManufacture: { canonicalKey: 'origin_country' },
      countryOfUltimateDestination: {
        canonicalKey: 'destination_country',
      },
      signatureName: { canonicalKey: 'signature_name' },
    },
    items: {
      noOfPkgs: { canonicalKey: 'package_count' },
      goodsDescription: { canonicalKey: 'product_description' },
      qty: { canonicalKey: 'quantity' },
      unitValue: { canonicalKey: 'unit_price' },
      totalValue: { canonicalKey: 'total_price' },
    },
  },
  [DocumentType.PACKING_LIST]: {
    fields: {
      exporterCompanyAddress: { canonicalKey: 'exporter_name_address' },
      exporterTaxId: { canonicalKey: 'nib' },
      exporterContactName: { canonicalKey: 'exporter_name' },
      exporterTelephone: { canonicalKey: 'exporter_telephone' },
      exporterEmail: { canonicalKey: 'exporter_email' },
      exporterCountry: { canonicalKey: 'origin_country' },
      consigneeCompanyAddress: { canonicalKey: 'consignee_name_address' },
      consigneeTaxId: { canonicalKey: 'consignee_tax_id' },
      consigneeContactName: { canonicalKey: 'consignee_name' },
      consigneeTelephone: { canonicalKey: 'consignee_telephone' },
      consigneeEmail: { canonicalKey: 'consignee_email' },
      consigneeCountry: { canonicalKey: 'destination_country' },
      shipDate: { canonicalKey: 'cargo_ready_date' },
      airWaybillNo: external('airwaybill_number', 'Available after booking'),
      invoiceNo: { canonicalKey: 'invoice_number' },
      purchaseOrderNo: { canonicalKey: 'purchase_order_number' },
      paymentTerms: { canonicalKey: 'payment_terms' },
      billOfLading: external(
        'bill_of_lading_number',
        'Waiting for Freight Forwarder',
      ),
      packageType: { canonicalKey: 'package_type' },
      portOfLoading: { canonicalKey: 'port_of_loading' },
      hsCode: { canonicalKey: 'hs_code', confirmWhenShipmentOnly: true },
      totalVolume: { canonicalKey: 'cbm' },
      specialInstructions: { canonicalKey: 'special_instructions' },
      totalGrossWeight: {
        canonicalKey: 'gross_weight',
        sourcePriority: ['uploaded_document', 'cargo', 'shipment'],
      },
      signatureNameTitleDate: { canonicalKey: 'signature_name' },
    },
    items: {
      noOfPackages: { canonicalKey: 'package_count' },
      noOfUnits: { canonicalKey: 'quantity' },
      netWeight: {
        canonicalKey: 'net_weight',
        sourcePriority: ['uploaded_document', 'cargo', 'shipment'],
      },
      unitOfMeasure: { canonicalKey: 'quantity_unit' },
      goodsDescription: { canonicalKey: 'product_description' },
      countryOfManufacture: { canonicalKey: 'origin_country' },
    },
  },
  [DocumentType.BILL_OF_LADING]: {
    fields: {
      bolDate: { canonicalKey: 'cargo_ready_date' },
      bolNumber: external(
        'bill_of_lading_number',
        'Waiting for Freight Forwarder',
      ),
      shipFromNameAddress: { canonicalKey: 'exporter_name_address' },
      shipFromSid: { canonicalKey: 'shipper_sid' },
      shipToNameAddress: { canonicalKey: 'consignee_name_address' },
      shipToLocationNo: { canonicalKey: 'consignee_location_number' },
      shipToCid: { canonicalKey: 'consignee_cid' },
      carrierName: external('carrier_name', 'Waiting for Freight Forwarder'),
      notifyParty: { canonicalKey: 'notify_party' },
      portOfLoading: { canonicalKey: 'port_of_loading' },
      portOfDischarge: { canonicalKey: 'port_of_discharge' },
      vesselName: external('vessel_name', 'Available after booking'),
      voyageNumber: external('voyage_number', 'Available after booking'),
      bookingNumber: external('booking_number', 'Available after booking'),
      containerNumber: external('container_number', 'Available after stuffing'),
      measurementCbm: { canonicalKey: 'cbm' },
      trailerNo: external('trailer_number', 'Not required yet'),
      sealNumbers: external('seal_number', 'Available after stuffing'),
      scac: external('scac', 'Waiting for Freight Forwarder'),
      proNo: external('pro_number', 'Waiting for Freight Forwarder'),
      thirdPartyBillTo: { canonicalKey: 'third_party_bill_to' },
      freightChargeTerms: external(
        'freight_terms',
        'Waiting for Freight Forwarder',
      ),
      specialInstructions: { canonicalKey: 'special_instructions' },
      codAmount: { canonicalKey: 'cod_amount' },
      shipperSignatureDate: { canonicalKey: 'signature_name' },
    },
    items: {
      handlingUnitQty: { canonicalKey: 'quantity' },
      handlingUnitType: { canonicalKey: 'quantity_unit' },
      packageQty: { canonicalKey: 'package_count' },
      packageType: { canonicalKey: 'package_type' },
      weight: {
        canonicalKey: 'gross_weight',
        sourcePriority: ['uploaded_document', 'cargo', 'shipment'],
      },
      goodsDescription: { canonicalKey: 'product_description' },
      nmfcNo: { canonicalKey: 'nmfc_number' },
      freightClass: { canonicalKey: 'freight_class' },
    },
  },
};

@Injectable()
export class DocumentAssistantService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(ExtractedField)
    private readonly fieldRepo: Repository<ExtractedField>,
    @InjectRepository(ShipmentFact)
    private readonly factRepo: Repository<ShipmentFact>,
    @InjectRepository(Container)
    private readonly containerRepo: Repository<Container>,
    @InjectRepository(Vessel)
    private readonly vesselRepo: Repository<Vessel>,
    private readonly documentsService: DocumentsService,
  ) {}

  async getOverview(shipmentId: string, userId: string) {
    const knowledge = await this.loadKnowledge(shipmentId, userId);
    const cards = Object.values(DocumentType).map((type) =>
      this.buildDocumentCard(type, knowledge),
    );
    const ready = cards.filter((card) =>
      ['valid', 'ready_to_generate', 'draft_generated', 'verified'].includes(
        card.status,
      ),
    ).length;
    const attention = cards.filter((card) =>
      ['needs_attention', 'missing_fields', 'conflict'].includes(card.status),
    ).length;
    const waiting = cards.length - ready - attention;
    const readinessPercent = Math.round(
      cards.reduce((sum, card) => sum + card.readiness.readinessPercent, 0) /
        Math.max(cards.length, 1),
    );
    const conflicts = this.crossDocumentConflicts(knowledge);

    return {
      shipment: this.shipmentSummary(knowledge.shipment),
      readiness: {
        readinessPercent,
        readyDocuments: ready,
        attentionDocuments: attention,
        unavailableDocuments: waiting,
      },
      company: {
        name: knowledge.user.businessName,
        nib: knowledge.user.nib,
        status: knowledge.user.nib ? 'valid' : 'missing_fields',
      },
      crossDocumentValidation: {
        status: conflicts.length ? 'conflict' : 'valid',
        conflictCount: conflicts.length,
        message: conflicts.length
          ? `${conflicts.length} inconsistencies found.`
          : 'All primary shipment information is consistent.',
        conflicts,
      },
      documents: cards,
    };
  }

  async getReadiness(shipmentId: string, userId: string, type: DocumentType) {
    const knowledge = await this.loadKnowledge(shipmentId, userId);
    return this.toCanonicalReadiness(this.buildReadiness(type, knowledge));
  }

  async validateUploadedDocument(
    shipmentId: string,
    documentId: string,
    userId: string,
  ) {
    const knowledge = await this.loadKnowledge(shipmentId, userId);
    const document = knowledge.documents.find((item) => item.id === documentId);
    if (!document?.type) throw new NotFoundException('Document not found');
    const generated = this.buildReadiness(document.type, knowledge);
    const fields = this.consolidateCanonicalFields(
      generated.fields.map((field) =>
        this.validateFieldForDocument(field, document, knowledge),
      ),
    );
    const readiness = this.calculateReadiness(fields);
    document.lastValidatedAt = new Date();
    document.validationCount = (document.validationCount ?? 0) + 1;
    document.status = readiness.conflictFields
      ? 'conflict'
      : readiness.missingFields || readiness.invalidFields
        ? 'needs_review'
        : 'verified';
    await this.documentRepo.save(document);
    return {
      document: {
        id: document.id,
        type: document.type,
        label: DOCUMENT_SCHEMAS[document.type].label,
        fileName: document.originalFileName,
        origin: document.documentOrigin ?? DocumentOrigin.UPLOADED,
        status: readiness.conflictFields
          ? 'conflict'
          : readiness.missingFields || readiness.invalidFields
            ? 'needs_attention'
            : 'valid',
      },
      shipment: this.shipmentSummary(knowledge.shipment),
      readiness,
      fields,
      debug: {
        parser: document.parserName,
        classificationConfidence: document.classificationConfidence,
        classificationMethod: document.classificationMethod,
        hasTextLayer: document.hasTextLayer,
      },
    };
  }

  async getHistory(shipmentId: string, userId: string) {
    const knowledge = await this.loadKnowledge(shipmentId, userId);
    const documents = knowledge.documents.map((document) => ({
      id: document.id,
      shipmentId: knowledge.shipment.shipmentCode,
      type: document.type,
      label: document.type
        ? DOCUMENT_SCHEMAS[document.type]?.label
        : 'Uploaded Document',
      origin: document.documentOrigin,
      status: document.status,
      fileName:
        document.originalFileName ?? document.fileUrl?.split('/').at(-1),
      fileUrl: document.fileUrl,
      docxFileUrl: document.docxFileUrl,
      version: document.fileVersion,
      createdAt: document.createdAt,
      generatedAt: document.generatedAt,
      lastValidatedAt: document.lastValidatedAt,
      validationCount: document.validationCount ?? 0,
    }));
    const events = documents
      .flatMap((document) => {
        const entries = [
          {
            id: `${document.id}:created`,
            documentId: document.id,
            documentType: document.type,
            documentLabel: document.label,
            action:
              document.origin === DocumentOrigin.GENERATED
                ? 'generated'
                : 'uploaded',
            occurredAt: document.generatedAt ?? document.createdAt,
            status: document.status,
          },
        ];
        if (document.lastValidatedAt)
          entries.push({
            id: `${document.id}:checked:${document.validationCount}`,
            documentId: document.id,
            documentType: document.type,
            documentLabel: document.label,
            action: 'checked',
            occurredAt: document.lastValidatedAt,
            status: document.status,
          });
        return entries;
      })
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime(),
      );
    return {
      shipment: this.shipmentSummary(knowledge.shipment),
      documents,
      events,
    };
  }

  async resolveConflict(
    shipmentId: string,
    userId: string,
    dto: ResolveDocumentConflictDto,
  ) {
    const knowledge = await this.loadKnowledge(shipmentId, userId);
    const existing = await this.factRepo.findOne({
      where: { shipmentId: knowledge.shipment.id, field: dto.field },
    });
    const sourceField = dto.sourceDocumentId
      ? await this.fieldRepo.findOne({
          where: {
            documentId: dto.sourceDocumentId,
            field: dto.field,
          },
        })
      : null;
    const fact =
      existing ??
      this.factRepo.create({
        shipmentId: knowledge.shipment.id,
        userId,
        field: dto.field,
      });
    fact.value = dto.value;
    fact.unit = dto.unit ?? null;
    fact.confidence = 1;
    fact.sourceFieldId = sourceField?.id ?? null;
    fact.isUserVerified = true;
    return this.factRepo.save(fact);
  }

  async generateDraft(
    shipmentId: string,
    userId: string,
    type: DocumentType,
    dto: GenerateDocumentDraftDto,
  ) {
    const knowledge = await this.loadKnowledge(shipmentId, userId);
    const result = this.buildReadiness(type, knowledge);
    const supplied = dto.fields ?? {};
    const fields: Record<string, string> = {};
    const item: Record<string, string> = {};
    const unresolved: Array<{
      key: string;
      label: string;
      requirement: 'required_before_generation';
    }> = [];

    for (const field of result.fields) {
      const suppliedValue = (
        supplied[field.key] ?? supplied[field.canonicalKey]
      )?.trim();
      const mapping = this.mappingFor(type, field.key);
      const value = suppliedValue || field.value || mapping.externalPlaceholder;
      if (field.required && !value && field.status !== 'waiting_external_data')
        unresolved.push({
          key: field.canonicalKey,
          label: field.label,
          requirement: 'required_before_generation',
        });
      if (field.required && field.status === 'conflict' && !suppliedValue)
        unresolved.push({
          key: field.canonicalKey,
          label: `${field.label} (conflict)`,
          requirement: 'required_before_generation',
        });
      if (
        field.required &&
        field.status === 'needs_confirmation' &&
        !suppliedValue
      )
        unresolved.push({
          key: field.canonicalKey,
          label: `${field.label} (confirmation required)`,
          requirement: 'required_before_generation',
        });
      if (field.key.startsWith('item:')) item[field.key.slice(5)] = value ?? '';
      else fields[field.key] = value ?? '';
    }
    if (unresolved.length)
      return {
        status: 'additional_information_required' as const,
        missingFields: [
          ...new Map(unresolved.map((field) => [field.key, field])).values(),
        ],
      };

    const schema = DOCUMENT_SCHEMAS[type];
    const createDto = {
      type,
      shipmentId: knowledge.shipment.id,
      fields,
      items: schema.itemsSchema ? [item] : undefined,
    };
    const templateResult =
      await this.documentsService.generateTemplateDocument?.(userId, createDto);
    if (templateResult?.status === 'additional_information_required')
      return templateResult;
    const generated =
      templateResult?.status === 'draft_generated'
        ? templateResult.document
        : await this.documentsService.createDocument(userId, createDto);
    return {
      ...generated,
      generatedSources: generated.generatedSources
        ? (JSON.parse(generated.generatedSources) as string[])
        : [],
    };
  }

  private async loadKnowledge(
    shipmentId: string,
    userId: string,
  ): Promise<ShipmentKnowledge> {
    const shipment = await this.shipmentRepo.findOne({
      where: [
        { id: shipmentId, userId },
        { shipmentCode: shipmentId, userId },
      ],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    const documents = await this.documentRepo.find({
      where: { shipmentId: shipment.id, userId },
      order: { createdAt: 'DESC' },
    });
    const documentIds = documents.map((document) => document.id);
    const [fields, facts, container] = await Promise.all([
      documentIds.length
        ? this.fieldRepo.find({
            where: { documentId: In(documentIds) },
            relations: { document: true },
          })
        : Promise.resolve([]),
      this.factRepo.find({ where: { shipmentId: shipment.id, userId } }),
      shipment.containerId
        ? this.containerRepo.findOneBy({ id: shipment.containerId })
        : Promise.resolve(null),
    ]);
    const vessel = container
      ? await this.vesselRepo.findOneBy({ mmsi: container.vesselMmsi })
      : null;
    const candidates = new Map<string, KnowledgeCandidate[]>();
    const add = (
      key: string,
      value: unknown,
      source: FieldSource,
      unit?: string | null,
      confidence?: number,
      verified = false,
    ) => {
      const stringValue =
        typeof value === 'string'
          ? value.trim()
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
      if (!this.isMeaningful(stringValue)) return;
      const candidate: KnowledgeCandidate = {
        key,
        value: stringValue,
        normalizedValue: this.normalize(key, stringValue),
        unit: unit ?? undefined,
        confidence,
        verified,
        source,
      };
      const existing = candidates.get(key) ?? [];
      if (
        !existing.some(
          (item) =>
            item.normalizedValue === candidate.normalizedValue &&
            item.source.sourceType === candidate.source.sourceType &&
            item.source.documentId === candidate.source.documentId,
        )
      )
        existing.push(candidate);
      candidates.set(key, existing);
    };
    const source = (
      sourceType: FieldSourceType,
      label: string,
    ): FieldSource => ({
      sourceType,
      label,
    });

    add('exporter_name', shipment.exporterName, source('shipment', 'Shipment'));
    add(
      'exporter_company',
      shipment.exporterCompany || user.businessName,
      source('company_profile', 'Company Profile'),
    );
    add(
      'exporter_address',
      shipment.exporterAddress || user.businessAddress,
      source('company_profile', 'Company Profile'),
    );
    add(
      'exporter_email',
      shipment.exporterEmail,
      source('shipment', 'Shipment'),
    );
    add('exporter_telephone', '', source('company_profile', 'Company Profile'));
    add('nib', user.nib, source('company_profile', 'Company Profile'));
    add(
      'exporter_name_address',
      [
        shipment.exporterCompany,
        shipment.exporterName,
        shipment.exporterAddress,
      ]
        .filter(Boolean)
        .join(', '),
      source('shipment', 'Shipment'),
    );
    add(
      'consignee_name',
      shipment.consigneeName,
      source('shipment', 'Shipment'),
    );
    add(
      'consignee_name_address',
      [
        shipment.consigneeCompany,
        shipment.consigneeName,
        shipment.consigneeAddress,
      ]
        .filter(Boolean)
        .join(', '),
      source('shipment', 'Shipment'),
    );
    add(
      'consignee_email',
      shipment.consigneeEmail,
      source('shipment', 'Shipment'),
    );
    add(
      'product_description',
      shipment.productDescription,
      source('cargo', 'Cargo Information'),
    );
    add(
      'product_category',
      shipment.productCategory,
      source('cargo', 'Cargo Information'),
    );
    add(
      'hs_code',
      shipment.productHsCode,
      source('cargo', 'Cargo Information'),
    );
    add(
      'quantity',
      shipment.productQuantity,
      source('cargo', 'Cargo Information'),
    );
    add(
      'quantity_unit',
      shipment.productQuantityUnit,
      source('cargo', 'Cargo Information'),
    );
    add(
      'gross_weight',
      shipment.productGrossWeight,
      source('cargo', 'Cargo Information'),
      shipment.productWeightUnit,
    );
    add(
      'net_weight',
      shipment.productNetWeight,
      source('cargo', 'Cargo Information'),
      shipment.productWeightUnit,
    );
    add(
      'package_type',
      shipment.productPackaging,
      source('cargo', 'Cargo Information'),
    );
    add('cbm', shipment.cbm, source('cargo', 'Cargo Information'), 'm3');
    add(
      'origin_country',
      shipment.countryOfOrigin,
      source('shipment', 'Shipment'),
    );
    add(
      'destination_country',
      shipment.destinationCountry,
      source('shipment', 'Shipment'),
    );
    add('port_of_loading', shipment.originPort, source('shipment', 'Shipment'));
    add(
      'port_of_discharge',
      shipment.destinationPort,
      source('shipment', 'Shipment'),
    );
    add(
      'cargo_ready_date',
      shipment.cargoReadyDate,
      source('shipment', 'Shipment'),
    );
    add(
      'invoice_number',
      shipment.invoiceNumber,
      source('shipment', 'Shipment'),
    );
    add('invoice_date', shipment.invoiceDate, source('shipment', 'Shipment'));
    add(
      'special_instructions',
      shipment.additionalHandling,
      source('cargo', 'Cargo Information'),
    );
    add(
      'certifying_role',
      'Exporter',
      source('company_profile', 'Company Profile'),
    );

    if (container) {
      const containerSource = source('container_match', 'Container Match');
      add('port_of_loading', container.originPort, containerSource);
      add('port_of_discharge', container.destinationCity, containerSource);
    }
    if (vessel) {
      const vesselSource = source('vessel_match', 'Vessel Match');
      add('vessel_name', vessel.name, vesselSource);
    }

    for (const field of fields) {
      add(
        field.field,
        field.value,
        {
          sourceType: 'uploaded_document',
          label:
            field.document.originalFileName ??
            DOCUMENT_SCHEMAS[field.document.type!]?.label ??
            'Uploaded Document',
          documentId: field.documentId,
          documentType: field.document.type ?? undefined,
          fileName: field.document.originalFileName ?? undefined,
          page: field.pageNumber ?? undefined,
          rawText: field.rawText ?? undefined,
          boundingBox: field.boundingBox
            ? (JSON.parse(field.boundingBox) as number[])
            : undefined,
        },
        field.unit,
        field.confidence,
        field.isCorrected,
      );
    }
    for (const fact of facts)
      add(
        fact.field,
        fact.value,
        source(
          'shipment',
          fact.isUserVerified ? 'User Confirmed Value' : 'Shipment Knowledge',
        ),
        fact.unit,
        fact.confidence,
        fact.isUserVerified,
      );

    for (const document of documents.filter(
      (item) => item.documentOrigin === DocumentOrigin.GENERATED && item.type,
    )) {
      const definition = DEFINITIONS[document.type!];
      const values = JSON.parse(document.fields || '{}') as Record<
        string,
        string
      >;
      Object.entries(values).forEach(([key, value]) => {
        const mapping = definition.fields[key];
        if (mapping)
          add(mapping.canonicalKey, value, {
            sourceType: 'generated_document',
            label: `Generated ${DOCUMENT_SCHEMAS[document.type!].label}`,
            documentId: document.id,
            documentType: document.type!,
          });
      });
    }
    return { shipment, user, documents, candidates };
  }

  private buildDocumentCard(type: DocumentType, knowledge: ShipmentKnowledge) {
    const result = this.toCanonicalReadiness(
      this.buildReadiness(type, knowledge),
    );
    const latest = knowledge.documents.find(
      (document) => document.type === type,
    );
    const origin = latest
      ? (latest.documentOrigin ??
        (latest.processingStatus
          ? DocumentOrigin.UPLOADED
          : DocumentOrigin.GENERATED))
      : null;
    let status = result.readiness.canGenerateDraft
      ? 'ready_to_generate'
      : result.readiness.conflictFields
        ? 'conflict'
        : result.readiness.missingFields || result.readiness.confirmationFields
          ? 'missing_fields'
          : result.readiness.waitingExternalFields
            ? 'waiting_external_data'
            : 'needs_attention';
    if (latest && origin === DocumentOrigin.UPLOADED) {
      const requiresAttention =
        result.readiness.conflictFields > 0 ||
        result.readiness.missingFields > 0 ||
        result.readiness.invalidFields > 0 ||
        result.readiness.confirmationFields > 0;
      status = requiresAttention ? 'needs_attention' : 'valid';
    }
    if (latest && origin === DocumentOrigin.GENERATED)
      status = 'draft_generated';
    return {
      type,
      label: DOCUMENT_SCHEMAS[type].label,
      category: DOCUMENT_SCHEMAS[type].category,
      status,
      origin,
      documentId: latest?.id ?? null,
      fileUrl: latest?.fileUrl ?? null,
      docxFileUrl: latest?.docxFileUrl ?? null,
      readiness: result.readiness,
      knownFields: result.readiness.validFields,
      totalFields: result.readiness.totalFields,
      sources: this.uniqueSourceLabels(result.fields),
      primaryAction: latest
        ? origin === DocumentOrigin.UPLOADED
          ? 'review'
          : 'preview'
        : result.readiness.canGenerateDraft
          ? 'generate'
          : 'resolve',
    };
  }

  private buildReadiness(type: DocumentType, knowledge: ShipmentKnowledge) {
    const schema = DOCUMENT_SCHEMAS[type];
    if (!schema) throw new NotFoundException(`Document type ${type} not found`);
    const definition = DEFINITIONS[type];
    const fields: DocumentField[] = schema.fields.map((field) =>
      this.buildField(
        field.key,
        field.label,
        field.required,
        definition.fields[field.key],
        knowledge,
      ),
    );
    if (schema.itemsSchema)
      fields.push(
        ...schema.itemsSchema.columns.map((field) =>
          this.buildField(
            `item:${field.key}`,
            `${schema.itemsSchema!.label} - ${field.label}`,
            field.required,
            definition.items![field.key],
            knowledge,
          ),
        ),
      );
    return {
      type,
      label: schema.label,
      category: schema.category,
      shipment: this.shipmentSummary(knowledge.shipment),
      fields,
      readiness: this.calculateReadiness(fields),
      sources: this.uniqueSourceLabels(fields),
    };
  }

  private buildField(
    key: string,
    label: string,
    required: boolean,
    mapping: FieldMapping,
    knowledge: ShipmentKnowledge,
  ): DocumentField {
    const candidates = [
      ...(knowledge.candidates.get(mapping.canonicalKey) ?? []),
    ];
    const priority = mapping.sourcePriority ?? DEFAULT_PRIORITY;
    candidates.sort((left, right) => {
      if (left.verified !== right.verified) return left.verified ? -1 : 1;
      const sourceRank =
        priority.indexOf(left.source.sourceType) -
        priority.indexOf(right.source.sourceType);
      return sourceRank || (right.confidence ?? 0) - (left.confidence ?? 0);
    });
    const selected = candidates[0];
    const uniqueValues = new Map<string, KnowledgeCandidate>();
    candidates.forEach((candidate) =>
      uniqueValues.set(candidate.normalizedValue, candidate),
    );
    let status: FieldValidationStatus = 'valid';
    if (!selected)
      status = mapping.externalMessage ? 'waiting_external_data' : 'missing';
    else if (!this.isValid(mapping.canonicalKey, selected.value))
      status = 'invalid';
    else if (uniqueValues.size > 1 && !selected.verified) status = 'conflict';
    else if (
      mapping.confirmWhenShipmentOnly &&
      !selected.verified &&
      !candidates.some(
        (candidate) => candidate.source.sourceType === 'uploaded_document',
      )
    )
      status = 'needs_confirmation';
    return {
      key,
      canonicalKey: mapping.canonicalKey,
      label,
      required,
      userEditable: !mapping.externalMessage,
      value: selected?.value,
      normalizedValue: selected?.normalizedValue,
      unit: selected?.unit,
      status,
      confidence: selected?.confidence,
      sources: candidates.map((candidate) => candidate.source),
      conflictCandidates:
        status === 'conflict'
          ? [...uniqueValues.values()].map((candidate): ConflictCandidate => ({
              value: candidate.value,
              normalizedValue: candidate.normalizedValue,
              unit: candidate.unit,
              source: candidate.source,
            }))
          : undefined,
      externalMessage: mapping.externalMessage,
    };
  }

  private validateFieldForDocument(
    field: DocumentField,
    document: Document,
    knowledge: ShipmentKnowledge,
  ): DocumentField {
    const candidates = knowledge.candidates.get(field.canonicalKey) ?? [];
    const verified = candidates.find((candidate) => candidate.verified);
    const documentCandidates = candidates.filter(
      (candidate) => candidate.source.documentId === document.id,
    );
    if (verified) {
      return {
        ...field,
        value: verified.value,
        normalizedValue: verified.normalizedValue,
        unit: verified.unit,
        confidence: verified.confidence,
        status: this.isValid(field.canonicalKey, verified.value)
          ? 'valid'
          : 'invalid',
        sources: [
          verified.source,
          ...documentCandidates
            .filter(
              (candidate) =>
                candidate.normalizedValue !== verified.normalizedValue,
            )
            .map((candidate) => candidate.source),
        ],
        conflictCandidates: undefined,
      };
    }
    const selected = documentCandidates[0];
    if (!selected)
      return {
        ...field,
        value: undefined,
        normalizedValue: undefined,
        sources: [],
        conflictCandidates: undefined,
        status: field.externalMessage ? 'waiting_external_data' : 'missing',
      };
    const competing = candidates.filter(
      (candidate) =>
        candidate.source.documentId !== document.id &&
        candidate.normalizedValue !== selected.normalizedValue,
    );
    const status: FieldValidationStatus = !this.isValid(
      field.canonicalKey,
      selected.value,
    )
      ? 'invalid'
      : competing.length && !selected.verified
        ? 'conflict'
        : 'valid';
    return {
      ...field,
      value: selected.value,
      normalizedValue: selected.normalizedValue,
      unit: selected.unit,
      confidence: selected.confidence,
      status,
      sources: [selected.source],
      conflictCandidates:
        status === 'conflict'
          ? [selected, ...competing].map((candidate) => ({
              value: candidate.value,
              normalizedValue: candidate.normalizedValue,
              unit: candidate.unit,
              source: candidate.source,
            }))
          : undefined,
    };
  }

  private calculateReadiness(fields: DocumentField[]): DocumentReadiness {
    const required = fields.filter((field) => field.required);
    const count = (status: FieldValidationStatus) =>
      fields.filter((field) => field.status === status).length;
    const blockers = required.filter(
      (field) =>
        field.status === 'missing' ||
        field.status === 'invalid' ||
        field.status === 'conflict' ||
        field.status === 'needs_confirmation',
    );
    const resolvedRequired = required.length - blockers.length;
    return {
      totalFields: fields.length,
      validFields: count('valid'),
      missingFields: count('missing'),
      conflictFields: count('conflict'),
      invalidFields: count('invalid'),
      confirmationFields: count('needs_confirmation'),
      waitingExternalFields: count('waiting_external_data'),
      readinessPercent: Math.round(
        (resolvedRequired / Math.max(required.length, 1)) * 100,
      ),
      canGenerateDraft: blockers.length === 0,
    };
  }

  /**
   * A controlled template may expose multiple document fields backed by the
   * same shipment fact (for example consignee/importer or export/manufacture
   * country). The assistant API exposes that fact once and lets the user pick
   * between distinct candidate values. Template aliases remain available in
   * documentKeys and are expanded again by generateDraft.
   */
  private consolidateCanonicalFields(fields: DocumentField[]): DocumentField[] {
    const groups = new Map<string, DocumentField[]>();
    for (const field of fields) {
      const current = groups.get(field.canonicalKey) ?? [];
      current.push(field);
      groups.set(field.canonicalKey, current);
    }

    const statusRank: Record<FieldValidationStatus, number> = {
      conflict: 6,
      invalid: 5,
      needs_confirmation: 4,
      missing: 3,
      waiting_external_data: 2,
      valid: 1,
    };

    return [...groups.entries()].map(([canonicalKey, aliases]) => {
      const primary = [...aliases].sort((left, right) => {
        if (left.required !== right.required) return left.required ? -1 : 1;
        return statusRank[right.status] - statusRank[left.status];
      })[0];
      const status = aliases.reduce<FieldValidationStatus>(
        (selected, field) =>
          statusRank[field.status] > statusRank[selected]
            ? field.status
            : selected,
        primary.status,
      );
      const sources = new Map<string, FieldSource>();
      const candidates = new Map<string, ConflictCandidate>();

      for (const alias of aliases) {
        for (const source of alias.sources) {
          const sourceKey = `${source.sourceType}:${source.documentId ?? ''}:${source.page ?? ''}:${source.label}`;
          if (!sources.has(sourceKey)) sources.set(sourceKey, source);
        }
        for (const candidate of alias.conflictCandidates ?? []) {
          const candidateKey = `${candidate.normalizedValue}:${candidate.source.sourceType}:${candidate.source.documentId ?? ''}`;
          if (!candidates.has(candidateKey))
            candidates.set(candidateKey, candidate);
        }
      }

      return {
        ...primary,
        key: canonicalKey,
        canonicalKey,
        documentKeys: aliases.flatMap(
          (alias) => alias.documentKeys ?? [alias.key],
        ),
        required: aliases.some((alias) => alias.required),
        userEditable: aliases.some((alias) => alias.userEditable),
        status,
        sources: [...sources.values()],
        conflictCandidates:
          status === 'conflict' ? [...candidates.values()] : undefined,
      };
    });
  }

  private toCanonicalReadiness<
    T extends { fields: DocumentField[]; readiness: DocumentReadiness },
  >(result: T): T {
    const fields = this.consolidateCanonicalFields(result.fields);
    return {
      ...result,
      fields,
      readiness: this.calculateReadiness(fields),
      sources: this.uniqueSourceLabels(fields),
    };
  }

  private crossDocumentConflicts(knowledge: ShipmentKnowledge) {
    const primaryKeys = [
      'quantity',
      'gross_weight',
      'net_weight',
      'cbm',
      'hs_code',
      'destination_country',
      'port_of_loading',
      'port_of_discharge',
      'exporter_name_address',
      'consignee_name_address',
    ];
    return primaryKeys.flatMap((key) => {
      const candidates = knowledge.candidates.get(key) ?? [];
      if (candidates.some((candidate) => candidate.verified)) return [];
      const values = new Map<string, KnowledgeCandidate>();
      candidates.forEach((candidate) =>
        values.set(candidate.normalizedValue, candidate),
      );
      return values.size > 1
        ? [
            {
              field: key,
              candidates: [...values.values()].map((candidate) => ({
                value: candidate.value,
                unit: candidate.unit,
                source: candidate.source,
              })),
            },
          ]
        : [];
    });
  }

  private mappingFor(type: DocumentType, key: string): FieldMapping {
    const definition = DEFINITIONS[type];
    return key.startsWith('item:')
      ? definition.items![key.slice(5)]
      : definition.fields[key];
  }

  private uniqueSourceLabels(fields: DocumentField[]): string[] {
    return [
      ...new Set(
        fields.flatMap((field) => field.sources.map((source) => source.label)),
      ),
    ];
  }

  private shipmentSummary(shipment: Shipment) {
    return {
      id: shipment.id,
      code: shipment.shipmentCode,
      origin: shipment.originPort || shipment.originCity,
      destination: `${shipment.destinationPort}, ${shipment.destinationCountry}`,
      cargoReadyDate: shipment.cargoReadyDate,
      status: shipment.status,
    };
  }

  private isMeaningful(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return Boolean(
      normalized &&
      !['-', 'n/a', 'not provided', 'tbd'].includes(normalized) &&
      !normalized.includes('pending carrier confirmation') &&
      !normalized.includes('to be confirmed'),
    );
  }

  private normalize(key: string, value: string): string {
    if (
      [
        'quantity',
        'package_count',
        'gross_weight',
        'net_weight',
        'cbm',
        'unit_price',
        'total_price',
      ].includes(key)
    ) {
      const number = value.replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
      return number ? String(Number(number[0])) : value.toLowerCase();
    }
    if (key === 'hs_code') return value.replace(/\D/g, '');
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private isValid(key: string, value: string): boolean {
    if (key === 'hs_code') return /^\d{6,10}$/.test(this.normalize(key, value));
    if (key.endsWith('_email')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (
      [
        'quantity',
        'package_count',
        'gross_weight',
        'net_weight',
        'cbm',
        'unit_price',
        'total_price',
      ].includes(key)
    )
      return Number(this.normalize(key, value)) > 0;
    return this.isMeaningful(value);
  }
}
