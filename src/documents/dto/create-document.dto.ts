import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { DocumentType } from '../entities/document.entity';

export class CreateDocumentDto {
  @ApiProperty({
    enum: DocumentType,
    example: DocumentType.CERTIFICATE_OF_ORIGIN,
    description: 'Jenis dokumen ekspor',
  })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiPropertyOptional({
    description: 'ID pengiriman terkait dokumen ini',
    example: 'uuid-shipment-id',
  })
  @IsOptional()
  @IsString()
  shipmentId?: string;

  @ApiProperty({
    description: 'Field header yang diisi user sesuai jenis dokumen',
    example: {
      exporterNameAddress: 'Batik Nusantara, Jl. Industri No. 5, Bandung, Indonesia',
      exporterTaxId: '1234567890123456',
      importerNameAddress: 'Tokyo Trading Co., 1-1 Shinjuku, Tokyo, Japan',
    },
  })
  @IsObject()
  @IsNotEmpty()
  fields: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Baris barang (multi-item), wajib untuk Certificate of Origin, Commercial Invoice, Packing List, dan Bill of Lading',
    example: [
      {
        goodsDescription: 'Batik Fabric, Cotton, Handmade',
        hsCode: '520819',
        countryOfOrigin: 'Indonesia',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  items?: Record<string, string>[];
}

export class DocumentTypeInfoDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  type: DocumentType;
}
