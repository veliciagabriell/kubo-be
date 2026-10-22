import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  ShipmentPaymentStatus,
  ShipmentStatus,
} from '../entities/shipment.entity';

export class UpdateShipmentProductDto {
  @ApiPropertyOptional({ example: 'Meja makan kayu jati solid' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({ example: '9403.60' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  hsCode?: string;

  @ApiPropertyOptional({ example: 'Furniture kayu' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  category?: string;

  @ApiPropertyOptional({ example: 18 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  quantity?: number;

  @ApiPropertyOptional({ example: 'unit' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  quantityUnit?: string;

  @ApiPropertyOptional({ example: 1850 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  grossWeight?: number;

  @ApiPropertyOptional({ example: 1640 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  netWeight?: number;

  @ApiPropertyOptional({ example: 'kg' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  weightUnit?: string;

  @ApiPropertyOptional({ example: 'Peti kayu fumigasi' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  packaging?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  stackable?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  fragile?: boolean;
}

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

  @ApiPropertyOptional({ example: '2026-08-24' })
  @IsOptional()
  @IsDateString()
  cargoReadyDate?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  flexibleDateEnd?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  cbm?: number;

  @ApiPropertyOptional({ type: UpdateShipmentProductDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateShipmentProductDto)
  product?: UpdateShipmentProductDto;

  @ApiPropertyOptional({
    type: String,
    example: 'Jaga tetap kering; dilarang ditumpuk',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  additionalHandling?: string | null;
}
