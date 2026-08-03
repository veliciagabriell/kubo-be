import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ExportPartyDto {
  @ApiProperty({ example: 'Aiko Tanaka' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Mori Living Co., Ltd.' })
  @IsString()
  @IsNotEmpty()
  company: string;

  @ApiProperty({ example: '2-8-4 Aomi, Koto, Tokyo' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'aiko@mori-living.jp' })
  @IsEmail()
  email: string;
}

export class ShipmentProductDto {
  @ApiProperty({ example: 'Meja makan kayu jati solid' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: '9403.60' })
  @IsString()
  @IsNotEmpty()
  hsCode: string;

  @ApiProperty({ example: 'Furniture kayu' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ example: 18 })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  quantity: number;

  @ApiProperty({ example: 'unit' })
  @IsString()
  @IsNotEmpty()
  quantityUnit: string;

  @ApiProperty({ example: 1850 })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  grossWeight: number;

  @ApiProperty({ example: 1640 })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  netWeight: number;

  @ApiPropertyOptional({ example: 'kg' })
  @IsOptional()
  @IsString()
  weightUnit?: string;

  @ApiProperty({ example: 'Peti kayu fumigasi' })
  @IsString()
  @IsNotEmpty()
  packaging: string;

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

export class CreateShipmentDto {
  @ApiProperty({ example: 'Jepara' })
  @IsString()
  @IsNotEmpty()
  originCity: string;

  @ApiProperty({ example: 'Tanjung Emas, Semarang' })
  @IsString()
  @IsNotEmpty()
  originPort: string;

  @ApiProperty({ example: 'Jepang' })
  @IsString()
  @IsNotEmpty()
  destinationCountry: string;

  @ApiProperty({ example: 'Tokyo' })
  @IsString()
  @IsNotEmpty()
  destinationPort: string;

  @ApiProperty({ example: '2026-08-18' })
  @IsString()
  @IsNotEmpty()
  cargoReadyDate: string;

  @ApiProperty({ example: '2026-08-25' })
  @IsString()
  @IsNotEmpty()
  flexibleDateEnd: string;

  @ApiProperty({ example: 5 })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  cbm: number;

  @ApiProperty({ type: ExportPartyDto })
  @ValidateNested()
  @Type(() => ExportPartyDto)
  consignee: ExportPartyDto;

  @ApiProperty({ type: ShipmentProductDto })
  @ValidateNested()
  @Type(() => ShipmentProductDto)
  product: ShipmentProductDto;

  @ApiPropertyOptional({ example: 'INV-JRK-0826-14' })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @ApiPropertyOptional({ example: 'Jaga tetap kering; dilarang ditumpuk' })
  @IsOptional()
  @IsString()
  additionalHandling?: string;
}
