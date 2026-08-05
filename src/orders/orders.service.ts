import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Container } from '../matching/entities/container.entity';
import {
  Shipment,
  ShipmentPaymentStatus,
  ShipmentStatus,
} from '../shipments/entities/shipment.entity';
import { Order, OrderStatus, PaymentMethod } from './entities/order.entity';
import { CreateOrderDto, OrderListQueryDto } from './dto/create-order.dto';

const SUBSCRIPTION_FEE = 19000;
const PLATFORM_FEE_PER_CBM = 500;
const DOCUMENT_ASSISTANCE_FEE = 0;
const PAYMENT_FEES: Record<PaymentMethod, number> = {
  [PaymentMethod.BANK_TRANSFER]: 0,
  [PaymentMethod.CREDIT_CARD]: 0.029,
  [PaymentMethod.E_WALLET]: 0.015,
};

export interface CostBreakdownView {
  freight: number;
  platformFee: number;
  documentAssistance: number;
  handling: number;
  insurance: number;
  taxes: number;
  subscription: number;
  total: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Container)
    private readonly containerRepo: Repository<Container>,
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
  ) {}

  private async generateOrderId(): Promise<string> {
    const count = await this.orderRepo.count();
    const num = 8800 + count + 1;
    return `ORD-${num}`;
  }

  private buildCosts(
    container: Container,
    volumeCbm: number,
    paymentMethod: PaymentMethod,
  ): CostBreakdownView {
    const freight = Math.round(container.costPerCbm * volumeCbm);
    const platformFee = Math.round(volumeCbm * PLATFORM_FEE_PER_CBM);
    const documentAssistance = DOCUMENT_ASSISTANCE_FEE;
    const subscription = SUBSCRIPTION_FEE;
    const subtotal = freight + platformFee + documentAssistance + subscription;
    const taxes = Math.round(subtotal * PAYMENT_FEES[paymentMethod]);
    const total = subtotal + taxes;
    return {
      freight,
      platformFee,
      documentAssistance,
      handling: 0,
      insurance: 0,
      taxes,
      subscription,
      total,
    };
  }

  async createOrder(userId: string, dto: CreateOrderDto): Promise<Order> {
    const container = await this.containerRepo.findOneBy({ id: dto.containerId });
    if (!container) throw new NotFoundException('Container not found');
    if (container.status !== 'open')
      throw new BadRequestException('Container is no longer available');

    const available = container.totalCapacityCbm - container.currentUsedCbm;
    if (dto.volumeCbm > available)
      throw new BadRequestException(
        `Insufficient space. Available: ${available.toFixed(2)} CBM`,
      );

    const costs = this.buildCosts(container, dto.volumeCbm, dto.paymentMethod);
    const paymentFeeRate = PAYMENT_FEES[dto.paymentMethod];
    const orderId = await this.generateOrderId();

    const order = this.orderRepo.create({
      orderId,
      userId,
      containerId: dto.containerId,
      shipmentId: dto.shipmentId ?? null,
      volumeCbm: dto.volumeCbm,
      destination: `${container.destinationCity}, ${container.destinationCountry}`,
      departureDate: container.departureDate,
      paymentMethod: dto.paymentMethod,
      cbmRate: container.costPerCbm,
      subscriptionFee: SUBSCRIPTION_FEE,
      paymentFee: costs.taxes,
      amountIdr: costs.total,
      status: OrderStatus.COMPLETED,
    });

    const saved = await this.orderRepo.save(order);

    // Update container usage
    container.currentUsedCbm = parseFloat(
      (container.currentUsedCbm + dto.volumeCbm).toFixed(2),
    );
    container.umkmCount += 1;
    if (container.currentUsedCbm >= container.totalCapacityCbm * 0.98) {
      container.status = 'full';
    }
    await this.containerRepo.save(container);

    if (dto.shipmentId) {
      const shipment = await this.shipmentRepo.findOne({
        where: [
          { id: dto.shipmentId, userId },
          { shipmentCode: dto.shipmentId, userId },
        ],
      });
      if (shipment) {
        shipment.containerId = dto.containerId;
        shipment.status = ShipmentStatus.BOOKED;
        shipment.paymentStatus = ShipmentPaymentStatus.FULLY_PAID;
        shipment.nextAction = 'Lengkapi dokumen ekspor';
        shipment.orderAmountIdr = costs.total;
        await this.shipmentRepo.save(shipment);
      }
    }

    return saved;
  }

  async getUserOrders(userId: string, query: OrderListQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (query.status) where.status = query.status;
    if (query.dateFrom && query.dateTo) {
      where.createdAt = Between(
        new Date(query.dateFrom),
        new Date(query.dateTo + 'T23:59:59'),
      );
    }

    const [orders, total] = await this.orderRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrderById(id: string, userId: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getCheckoutPreview(dto: CreateOrderDto) {
    const container = await this.containerRepo.findOneBy({ id: dto.containerId });
    if (!container) throw new NotFoundException('Container not found');

    const costs = this.buildCosts(container, dto.volumeCbm, dto.paymentMethod);

    return {
      destination: `${container.destinationCity}, ${container.destinationCountry.slice(0, 2).toUpperCase()}`,
      departureDate: container.departureDate,
      containerType: container.containerType,
      volumeCbm: dto.volumeCbm,
      costs,
      totalDue: costs.total,
      paymentMethod: dto.paymentMethod,
    };
  }
}
