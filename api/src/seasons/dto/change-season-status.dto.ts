import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SeasonStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ChangeSeasonStatusDto {
  @ApiProperty({ enum: SeasonStatus, example: SeasonStatus.ACTIVE })
  @IsEnum(SeasonStatus)
  status: SeasonStatus;

  @ApiProperty({ example: 1, description: 'Version lue avant modification (R13)' })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({
    example: 'Correction des inscriptions de juin',
    description: 'Motif obligatoire pour rouvrir une saison clôturée ou historique (R1)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}
