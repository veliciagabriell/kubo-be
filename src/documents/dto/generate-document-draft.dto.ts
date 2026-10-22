import { IsObject, IsOptional } from 'class-validator';

export class GenerateDocumentDraftDto {
  @IsOptional()
  @IsObject()
  fields?: Record<string, string>;
}
