import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ShipmentPaymentStatus, ShipmentStatus } from '../entities/shipment.entity';

export class UpdateShipmentDto {
  @ApiPropertyOptional({ enum: ShipmentStatus })
  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;

  @ApiPropertyOptional({ enum: ShipmentPaymentStatus })
  @IsOptional()
  @IsEnum(ShipmentPaymentStatus)
  paymentStatus?: ShipmentPaymentStatus;

  @ApiPropertyOptional({ example: 'Lengkapi Packing List' })
  @IsOptional()
  @IsString()
  nextAction?: string;
}
