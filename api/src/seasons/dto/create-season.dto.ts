import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SeasonStatus } from '@prisma/client';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Statuts autorisés à la création : ACTIVE passe par le changement de statut (R2). */
export const CREATABLE_STATUSES = [SeasonStatus.DRAFT, SeasonStatus.HISTORICAL] as const;

export class CreateSeasonDto {
  @ApiProperty({ example: '2026-2027', description: 'Libellé unique de la saison' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  label: string;

  @ApiProperty({ example: '2026-09-01', description: 'Date de début (AAAA-MM-JJ)' })
  @IsISO8601({ strict: true }, { message: 'startDate doit être une date AAAA-MM-JJ' })
  startDate: string;

  @ApiProperty({ example: '2027-06-30', description: 'Date de fin (AAAA-MM-JJ)' })
  @IsISO8601({ strict: true }, { message: 'endDate doit être une date AAAA-MM-JJ' })
  endDate: string;

  @ApiPropertyOptional({
    enum: CREATABLE_STATUSES,
    default: SeasonStatus.DRAFT,
    description: 'HISTORICAL pour une saison passée créée avant l’import',
  })
  @IsOptional()
  @IsIn(CREATABLE_STATUSES, { message: 'status doit être DRAFT ou HISTORICAL' })
  status?: (typeof CREATABLE_STATUSES)[number];
}
