import { IsOptional, IsString } from 'class-validator';

export class ResolveDocumentConflictDto {
  @IsString()
  field: string;

  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  sourceDocumentId?: string;
}
