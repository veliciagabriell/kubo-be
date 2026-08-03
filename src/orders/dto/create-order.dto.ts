import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaymentMethod } from '../entities/order.entity';

export class CreateOrderDto {
  @ApiProperty({
    description: 'ID container yang dipilih dari hasil matching',
    example: 'uuid-container-id',
  })
  @IsUUID()
  containerId: string;

  @ApiProperty({ example: 5.0, description: 'Volume muatan dalam CBM' })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  volumeCbm: number;

  @ApiProperty({
    enum: PaymentMethod,
    example: PaymentMethod.BANK_TRANSFER,
    description: 'Metode pembayaran',
  })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({
    description: 'ID pengiriman yang dibooking pada container ini',
    example: 'uuid-shipment-id',
  })
  @IsOptional()
  @IsString()
  shipmentId?: string;
}

export class OrderListQueryDto {
  @ApiProperty({ required: false, example: 'pending' })
  status?: string;

  @ApiProperty({ required: false, example: '2024-01-01' })
  dateFrom?: string;

  @ApiProperty({ required: false, example: '2024-12-31' })
  dateTo?: string;

  @ApiProperty({ required: false, example: 1 })
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false, example: 10 })
  @Type(() => Number)
  limit?: number;
}
