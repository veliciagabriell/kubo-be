import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Adi Wijaya Baru' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Batik Nusantara Premium' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({ example: 'Kerajinan Tekstil & Batik' })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ example: 'Jl. Merdeka No. 15, Jakarta Pusat' })
  @IsOptional()
  @IsString()
  ownerAddress?: string;

  @ApiPropertyOptional({ example: 'Jl. Industri No. 8, Bandung' })
  @IsOptional()
  @IsString()
  businessAddress?: string;

  @ApiPropertyOptional({ example: '9876543210123456' })
  @IsOptional()
  @IsString()
  nib?: string;
}
