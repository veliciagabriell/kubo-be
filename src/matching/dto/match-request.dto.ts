import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class MatchRequestDto {
  @ApiProperty({
    example: 'Japan',
    description: 'Negara tujuan pengiriman (saat ini hanya Japan)',
    enum: ['Japan'],
  })
  @IsIn(['Japan'])
  destinationCountry: string;

  @ApiProperty({
    example: 5.0,
    description: 'Volume muatan dalam satuan CBM (Cubic Meter)',
  })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  volumeCbm: number;

  @ApiProperty({
    example: '2024-10-20',
    description: 'Tanggal pengiriman yang diinginkan (YYYY-MM-DD)',
  })
  @IsDateString()
  preferredDate: string;
}
