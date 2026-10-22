import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Container } from '../../matching/entities/container.entity';
import { Shipment } from '../../shipments/entities/shipment.entity';
import { User } from '../../users/entities/user.entity';
import { Vessel } from '../../vessels/entities/vessel.entity';
import { ShipmentFact } from '../entities/shipment-fact.entity';
import { CanonicalShipmentData } from './canonical-shipment.types';

function numberValue(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

@Injectable()
export class CanonicalShipmentService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ShipmentFact)
    private readonly factRepo: Repository<ShipmentFact>,
    @InjectRepository(Container)
    private readonly containerRepo: Repository<Container>,
    @InjectRepository(Vessel)
    private readonly vesselRepo: Repository<Vessel>,
  ) {}

  async getShipmentData(
    shipmentIdOrCode: string,
    userId: string,
  ): Promise<CanonicalShipmentData> {
    const shipment = await this.shipmentRepo.findOne({
      where: [
        { id: shipmentIdOrCode, userId },
        { shipmentCode: shipmentIdOrCode, userId },
      ],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const [user, factRows, container] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.factRepo.find({ where: { shipmentId: shipment.id, userId } }),
      shipment.containerId
        ? this.containerRepo.findOne({ where: { id: shipment.containerId } })
        : Promise.resolve(null),
    ]);
    const vessel = container
      ? await this.vesselRepo.findOne({ where: { mmsi: container.vesselMmsi } })
      : null;
    const facts = Object.fromEntries(
      factRows.map((fact) => [fact.field, fact.value]),
    );
    const fact = (...keys: string[]) =>
      keys.map((key) => facts[key]).find((value) => Boolean(value));
    const packageCount = numberValue(
      fact('package_count', 'number_of_packages', 'no_of_packages'),
    );
    const unitPrice = numberValue(fact('unit_price', 'commercial_unit_price'));
    const totalValue =
      numberValue(fact('total_value', 'total_invoice_value')) ??
      (unitPrice ? unitPrice * shipment.productQuantity : undefined);
    const cargo = {
      description: fact('product_description') ?? shipment.productDescription,
      hsCode: fact('hs_code') ?? shipment.productHsCode,
      quantity: numberValue(fact('quantity')) ?? shipment.productQuantity,
      quantityUnit: fact('quantity_unit') ?? shipment.productQuantityUnit,
      grossWeightKg:
        numberValue(fact('gross_weight', 'gross_weight_kg')) ??
        shipment.productGrossWeight,
      netWeightKg:
        numberValue(fact('net_weight', 'net_weight_kg')) ??
        shipment.productNetWeight,
      finalCbm: numberValue(fact('cbm', 'final_cbm')) ?? shipment.cbm,
      packageCount,
      packageType: fact('package_type') ?? shipment.productPackaging,
      countryOfOrigin:
        fact('origin_country', 'country_of_origin') ?? shipment.countryOfOrigin,
      specialHandling:
        fact('special_handling', 'special_instructions') ??
        shipment.additionalHandling ??
        undefined,
      unitPrice,
      totalValue,
    };

    return {
      shipmentId: shipment.id,
      shipmentCode: shipment.shipmentCode,
      exporter: {
        companyName:
          fact('exporter_company', 'exporter_name') ??
          shipment.exporterCompany ??
          user?.businessName,
        contactName: fact('exporter_contact_name') ?? shipment.exporterName,
        address:
          fact('exporter_address') ??
          shipment.exporterAddress ??
          user?.businessAddress,
        country: fact('exporter_country', 'origin_country') ?? 'Indonesia',
        taxId: fact('exporter_tax_id', 'tax_id', 'nib') ?? user?.nib,
        phone: fact('exporter_phone', 'exporter_telephone'),
        email: fact('exporter_email') ?? shipment.exporterEmail,
      },
      consignee: {
        companyName:
          fact('consignee_company', 'consignee_name') ??
          shipment.consigneeCompany,
        contactName: fact('consignee_contact_name') ?? shipment.consigneeName,
        address: fact('consignee_address') ?? shipment.consigneeAddress,
        country:
          fact('consignee_country', 'destination_country') ??
          shipment.destinationCountry,
        taxId: fact('consignee_tax_id'),
        phone: fact('consignee_phone', 'consignee_telephone'),
        email: fact('consignee_email') ?? shipment.consigneeEmail,
      },
      cargo,
      items: [cargo],
      route: {
        originPort: fact('port_of_loading') ?? shipment.originPort,
        destinationPort: fact('port_of_discharge') ?? shipment.destinationPort,
        originCountry:
          fact('origin_country', 'country_of_origin') ??
          shipment.countryOfOrigin,
        destinationCountry:
          fact('destination_country') ?? shipment.destinationCountry,
        cargoReadyDate: fact('cargo_ready_date') ?? shipment.cargoReadyDate,
        estimatedDeparture:
          fact('estimated_departure') ?? container?.departureDate,
        cargoCutoff:
          fact('cargo_cutoff') ?? container?.cargoCutoffDate ?? undefined,
      },
      containerMatch: container
        ? {
            shipmentType: 'Consolidated LCL',
            freightForwarderName:
              fact('freight_forwarder_name', 'carrier_name') ??
              'KUBO Freight Partner',
            vesselName: fact('vessel_name') ?? vessel?.name ?? undefined,
            voyageNumber: fact('voyage_number') ?? container.voyageId,
            bookingNumber: fact('booking_number'),
            containerNumber: fact('container_number'),
            sealNumber: fact('seal_number'),
          }
        : undefined,
      commercial: {
        invoiceNumber:
          fact('invoice_number') ?? shipment.invoiceNumber ?? undefined,
        invoiceDate: fact('invoice_date') ?? shipment.invoiceDate ?? undefined,
        currency: fact('currency'),
        unitPrice,
        totalValue,
        paymentTerms: fact('payment_terms'),
        purchaseOrderNumber: fact('purchase_order_number'),
      },
      billOfLading: { number: fact('bol_number', 'bill_of_lading_number') },
      facts,
    };
  }
}
