import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import {
  Shipment,
  ShipmentPaymentStatus,
  ShipmentStatus,
} from './entities/shipment.entity';

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
      where: [
        { id, userId },
        { shipmentCode: id, userId },
      ],
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

    const productUpdate = dto.product;
    const cargoChanged =
      dto.cargoReadyDate !== undefined ||
      dto.flexibleDateEnd !== undefined ||
      dto.cbm !== undefined ||
      dto.additionalHandling !== undefined ||
      (productUpdate !== undefined && Object.keys(productUpdate).length > 0);

    if (
      cargoChanged &&
      ![ShipmentStatus.DRAFT, ShipmentStatus.AWAITING_MATCH].includes(
        shipment.status,
      )
    ) {
      throw new BadRequestException(
        'Informasi kargo hanya dapat diubah sebelum shipment mendapatkan match',
      );
    }

    const cargoReadyDate = dto.cargoReadyDate ?? shipment.cargoReadyDate;
    const flexibleDateEnd = dto.flexibleDateEnd ?? shipment.flexibleDateEnd;
    if (cargoReadyDate > flexibleDateEnd) {
      throw new BadRequestException(
        'Cargo Ready Date tidak boleh melewati batas fleksibel keberangkatan',
      );
    }

    const grossWeight =
      productUpdate?.grossWeight ?? shipment.productGrossWeight;
    const netWeight = productUpdate?.netWeight ?? shipment.productNetWeight;
    if (netWeight > grossWeight) {
      throw new BadRequestException(
        'Berat bersih tidak boleh lebih besar dari berat kotor',
      );
    }

    if (dto.status !== undefined) shipment.status = dto.status;
    if (dto.paymentStatus !== undefined)
      shipment.paymentStatus = dto.paymentStatus;
    if (dto.nextAction !== undefined) shipment.nextAction = dto.nextAction;
    if (dto.cargoReadyDate !== undefined)
      shipment.cargoReadyDate = dto.cargoReadyDate;
    if (dto.flexibleDateEnd !== undefined)
      shipment.flexibleDateEnd = dto.flexibleDateEnd;
    if (dto.cbm !== undefined) shipment.cbm = dto.cbm;
    if (dto.additionalHandling !== undefined)
      shipment.additionalHandling = dto.additionalHandling?.trim() || null;

    if (productUpdate?.description !== undefined)
      shipment.productDescription = productUpdate.description;
    if (productUpdate?.hsCode !== undefined)
      shipment.productHsCode = productUpdate.hsCode;
    if (productUpdate?.category !== undefined)
      shipment.productCategory = productUpdate.category;
    if (productUpdate?.quantity !== undefined)
      shipment.productQuantity = productUpdate.quantity;
    if (productUpdate?.quantityUnit !== undefined)
      shipment.productQuantityUnit = productUpdate.quantityUnit;
    if (productUpdate?.grossWeight !== undefined)
      shipment.productGrossWeight = productUpdate.grossWeight;
    if (productUpdate?.netWeight !== undefined)
      shipment.productNetWeight = productUpdate.netWeight;
    if (productUpdate?.weightUnit !== undefined)
      shipment.productWeightUnit = productUpdate.weightUnit;
    if (productUpdate?.packaging !== undefined)
      shipment.productPackaging = productUpdate.packaging;
    if (productUpdate?.stackable !== undefined)
      shipment.productStackable = productUpdate.stackable;
    if (productUpdate?.fragile !== undefined)
      shipment.productFragile = productUpdate.fragile;

    return this.shipmentRepo.save(shipment);
  }
}
