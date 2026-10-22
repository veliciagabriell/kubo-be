import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMimeType,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType } from '../entities/document.entity';

export class CreateDocumentUploadDto {
  @ApiProperty({ example: 'commercial-invoice.pdf' })
  @IsString()
  fileName: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsMimeType()
  mimeType: string;

  @ApiProperty({ example: 1048576, maximum: 26214400 })
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  fileSize: number;

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(DocumentType)
  declaredDocumentType?: DocumentType;
}

export class CompleteDocumentUploadDto extends CreateDocumentUploadDto {
  @ApiProperty({ example: 'supabase://documents/users/...' })
  @IsString()
  storageReference: string;

  @ApiProperty({ description: 'Lowercase SHA-256 hex digest' })
  @Matches(/^[a-f0-9]{64}$/)
  sha256: string;
}
