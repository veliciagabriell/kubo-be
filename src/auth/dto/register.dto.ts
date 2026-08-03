import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Adi Wijaya' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'adi@umkm.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Batik Nusantara' })
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @ApiProperty({ example: 'Kerajinan Tekstil' })
  @IsString()
  @IsNotEmpty()
  businessType: string;

  @ApiProperty({ example: 'Jl. Merdeka No. 10, Jakarta' })
  @IsString()
  @IsNotEmpty()
  ownerAddress: string;

  @ApiProperty({ example: 'Jl. Industri No. 5, Bandung' })
  @IsString()
  @IsNotEmpty()
  businessAddress: string;

  @ApiPropertyOptional({ example: '1234567890123456' })
  @IsOptional()
  @IsString()
  nib?: string;
}
