import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Document,
  DocumentOrigin,
  DocumentType,
  ProcessingStatus,
} from '../documents/entities/document.entity';
import { ExtractedField } from '../documents/entities/extracted-field.entity';
import { Container } from '../matching/entities/container.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import {
  Shipment,
  ShipmentPaymentStatus,
} from '../shipments/entities/shipment.entity';
import { User } from '../users/entities/user.entity';

const documentDefinition: Partial<
  Record<DocumentType, { type: string; label: string }>
> = {
  [DocumentType.COMMERCIAL_INVOICE]: {
    type: 'commercial_invoice',
    label: 'Commercial Invoice',
  },
  [DocumentType.PACKING_LIST]: {
    type: 'packing_list',
    label: 'Packing List',
  },
  [DocumentType.CERTIFICATE_OF_ORIGIN]: {
    type: 'certificate_of_origin',
    label: 'Certificate of Origin',
  },
  [DocumentType.SVLK]: {
    type: 'svlk',
    label: 'Sistem Verifikasi Legalitas Kayu',
  },
  [DocumentType.BILL_OF_LADING]: {
    type: 'bill_of_lading',
    label: 'Bill of Lading',
  },
};

const visibleDocumentStatuses = new Set([
  'uploaded',
  'processing',
  'draft',
  'draft_generated',
  'conflict',
  'needs_information',
  'needs_review',
  'ready_for_verification',
  'verified',
  'superseded',
  'waiting_external_data',
]);

function documentStatus(document: Document) {
  if (visibleDocumentStatuses.has(document.status)) return document.status;
  if (
    document.processingStatus &&
    ![ProcessingStatus.COMPLETED, ProcessingStatus.NEEDS_REVIEW].includes(
      document.processingStatus,
    )
  ) {
    return 'processing';
  }
  if (document.processingStatus === ProcessingStatus.NEEDS_REVIEW)
    return 'needs_review';
  return document.documentOrigin === DocumentOrigin.GENERATED
    ? 'draft'
    : 'uploaded';
}

@Injectable()
export class ForwarderService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(Container)
    private readonly containerRepo: Repository<Container>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(ExtractedField)
    private readonly extractedFieldRepo: Repository<ExtractedField>,
  ) {}

  private assertForwarder(user: User) {
    if (!/freight|forwarder|logistic|shipping/i.test(user.businessType)) {
      throw new ForbiddenException(
        'Only Freight Forwarder accounts can access customer shipments',
      );
    }
  }

  async getConfirmedCustomers(user: User) {
    this.assertForwarder(user);
    const containers = await this.containerRepo.find({
      where: { freightForwarderId: user.id },
    });
    if (!containers.length) return [];

    const containerIds = containers.map((container) => container.id);
    const shipments = await this.shipmentRepo.find({
      where: {
        containerId: In(containerIds),
        paymentStatus: In([
          ShipmentPaymentStatus.FULLY_PAID,
          ShipmentPaymentStatus.DEPOSIT_PAID,
        ]),
      },
      order: { updatedAt: 'DESC' },
    });

    const containerById = new Map(
      containers.map((container) => [container.id, container]),
    );
    return Promise.all(
      shipments.map((shipment) =>
        this.buildCustomer(
          shipment,
          containerById.get(shipment.containerId ?? '')!,
          user,
        ),
      ),
    );
  }

  async getCustomerShipment(user: User, shipmentId: string) {
    const customers = await this.getConfirmedCustomers(user);
    const customer = customers.find(
      (item) =>
        item.shipmentId === shipmentId ||
        item.internalShipmentId === shipmentId,
    );
    if (!customer)
      throw new NotFoundException('Forwarder customer shipment not found');
    return customer;
  }

  private async buildCustomer(
    shipment: Shipment,
    container: Container,
    freightForwarder: User,
  ) {
    const [order, documents] = await Promise.all([
      this.orderRepo.findOne({
        where: [
          { shipmentId: shipment.id, status: OrderStatus.COMPLETED },
          {
            shipmentId: shipment.shipmentCode,
            status: OrderStatus.COMPLETED,
          },
        ],
        order: { createdAt: 'DESC' },
      }),
      this.loadDocuments(shipment),
    ]);
    const readyDocumentTypes = new Set(
      documents
        .filter(
          (document) =>
            ![
              'conflict',
              'needs_information',
              'needs_review',
              'processing',
            ].includes(document.status),
        )
        .map((document) => document.type),
    );

    return {
      internalShipmentId: shipment.id,
      shipmentId: shipment.shipmentCode,
      exporter: shipment.exporterCompany || shipment.exporterName,
      exporterContact: `${shipment.exporterName} · ${shipment.exporterEmail}`,
      origin: shipment.originCity,
      destination: `${shipment.destinationPort}, ${shipment.destinationCountry}`,
      cargoReadyDate: shipment.cargoReadyDate,
      cargoCutoff: container.cargoCutoffDate ?? shipment.cargoReadyDate,
      cbm: shipment.cbm,
      grossWeightKg: shipment.productGrossWeight,
      netWeightKg: shipment.productNetWeight,
      product: shipment.productDescription,
      hsCode: shipment.productHsCode,
      quantity: `${shipment.productQuantity} ${shipment.productQuantityUnit}`,
      packaging: shipment.productPackaging,
      handling: shipment.additionalHandling ?? 'Tidak ada penanganan khusus',
      consignee: [
        shipment.consigneeCompany,
        shipment.consigneeName,
        shipment.consigneeAddress,
      ]
        .filter(Boolean)
        .join(', '),
      paymentStatus:
        shipment.paymentStatus === ShipmentPaymentStatus.FULLY_PAID
          ? 'fully_paid'
          : 'deposit_paid',
      amountPaid: order?.amountIdr ?? shipment.orderAmountIdr ?? 0,
      paymentDate: (order?.createdAt ?? shipment.updatedAt).toISOString(),
      bookingReference: order?.orderId ?? shipment.shipmentCode,
      documentReadiness: Math.round((readyDocumentTypes.size / 5) * 100),
      shipmentStatus: shipment.status,
      matching: {
        originPort: container.originPort,
        destinationPort: container.destinationCity,
        shipmentType: 'Consolidated LCL',
        estimatedDeparture: container.departureDate,
        cargoCutoff: container.cargoCutoffDate ?? shipment.cargoReadyDate,
        remainingCapacityCbm: Math.max(
          0,
          container.totalCapacityCbm - container.currentUsedCbm,
        ),
        freightForwarder: freightForwarder.businessName,
        status: shipment.status,
      },
      documents,
    };
  }

  private async loadDocuments(shipment: Shipment) {
    const documents = await this.documentRepo.find({
      where: [
        { shipmentId: shipment.id, userId: shipment.userId },
        { shipmentId: shipment.shipmentCode, userId: shipment.userId },
      ],
      order: { updatedAt: 'DESC' },
    });
    const supported = documents.filter(
      (document) => document.type && documentDefinition[document.type],
    );
    const extractions = supported.length
      ? await this.extractedFieldRepo.find({
          where: { documentId: In(supported.map((document) => document.id)) },
        })
      : [];

    return supported.map((document) => {
      const definition = documentDefinition[document.type!]!;
      return {
        id: document.id,
        shipmentId: shipment.shipmentCode,
        type: definition.type,
        label: definition.label,
        fileName:
          document.originalFileName ?? document.fileUrl?.split('/').at(-1),
        fileUrl: document.fileUrl,
        status: documentStatus(document),
        origin: document.documentOrigin,
        version: document.fileVersion,
        extractedFields: extractions
          .filter((field) => field.documentId === document.id)
          .map((field) => ({
            fieldKey: field.field,
            label: field.field.replaceAll('_', ' '),
            value: field.unit ? `${field.value} ${field.unit}` : field.value,
            confidence: field.confidence,
            sourceDocumentId: document.id,
            sourcePage: field.pageNumber ?? undefined,
            source: {
              sourceType: 'uploaded_document',
              label: definition.label,
              documentId: document.id,
              fileName: document.originalFileName ?? undefined,
              page: field.pageNumber ?? undefined,
              rawText: field.rawText ?? undefined,
              boundingBox: field.boundingBox
                ? (JSON.parse(field.boundingBox) as number[])
                : undefined,
            },
            status: field.isCorrected ? 'confirmed' : 'consistent',
          })),
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        lastCheckedAt: document.lastValidatedAt?.toISOString() ?? null,
        checkCount: document.validationCount,
      };
    });
  }
}
