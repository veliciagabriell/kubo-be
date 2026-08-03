import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { Shipment, ShipmentPaymentStatus, ShipmentStatus } from './entities/shipment.entity';

@Injectable()
export class ShipmentsService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
  ) {}

  private async generateShipmentCode(): Promise<string> {
    const count = await this.shipmentRepo.count();
    const num = 24080 + count + 1;
    return `KUB-${num}`;
  }

  async createShipment(user: User, dto: CreateShipmentDto): Promise<Shipment> {
    const shipmentCode = await this.generateShipmentCode();

    const shipment = this.shipmentRepo.create({
      shipmentCode,
      userId: user.id,
      originCity: dto.originCity,
      originPort: dto.originPort,
      destinationCountry: dto.destinationCountry,
      destinationPort: dto.destinationPort,
      cargoReadyDate: dto.cargoReadyDate,
      flexibleDateEnd: dto.flexibleDateEnd,
      cbm: dto.cbm,
      status: ShipmentStatus.AWAITING_MATCH,
      paymentStatus: ShipmentPaymentStatus.UNPAID,
      nextAction: 'Cari container match',
      exporterName: user.name,
      exporterCompany: user.businessName,
      exporterAddress: user.businessAddress,
      exporterEmail: user.email,
      consigneeName: dto.consignee.name,
      consigneeCompany: dto.consignee.company,
      consigneeAddress: dto.consignee.address,
      consigneeEmail: dto.consignee.email,
      productDescription: dto.product.description,
      productHsCode: dto.product.hsCode,
      productCategory: dto.product.category,
      productQuantity: dto.product.quantity,
      productQuantityUnit: dto.product.quantityUnit,
      productGrossWeight: dto.product.grossWeight,
      productNetWeight: dto.product.netWeight,
      productWeightUnit: dto.product.weightUnit || 'kg',
      productPackaging: dto.product.packaging,
      productStackable: dto.product.stackable ?? false,
      productFragile: dto.product.fragile ?? false,
      invoiceNumber: dto.invoiceNumber ?? null,
      invoiceDate: dto.invoiceDate ?? null,
      additionalHandling: dto.additionalHandling ?? null,
    });

    return this.shipmentRepo.save(shipment);
  }

  async getUserShipments(userId: string): Promise<Shipment[]> {
    return this.shipmentRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getShipmentById(id: string, userId: string): Promise<Shipment> {
    const shipment = await this.shipmentRepo.findOne({
      where: [{ id, userId }, { shipmentCode: id, userId }],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  async updateShipment(
    id: string,
    userId: string,
    dto: UpdateShipmentDto,
  ): Promise<Shipment> {
    const shipment = await this.getShipmentById(id, userId);
    Object.assign(shipment, dto);
    return this.shipmentRepo.save(shipment);
  }
}
