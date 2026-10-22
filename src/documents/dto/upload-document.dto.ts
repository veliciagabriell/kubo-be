import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType } from '../entities/document.entity';

export class UploadDocumentDto {
  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(DocumentType)
  declaredDocumentType?: DocumentType;
}
