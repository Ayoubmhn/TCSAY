import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateSeasonDto {
  @ApiProperty({ example: 1, description: 'Version lue avant modification (R13)' })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ example: '2026-2027' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  label?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'startDate doit être une date AAAA-MM-JJ' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-06-30' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'endDate doit être une date AAAA-MM-JJ' })
  endDate?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Loisirs : début (par défaut 1er octobre)' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'leisureStartDate doit être une date AAAA-MM-JJ' })
  leisureStartDate?: string;

  @ApiPropertyOptional({ example: '2027-06-30', description: 'Loisirs : fin (par défaut 30 juin)' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'leisureEndDate doit être une date AAAA-MM-JJ' })
  leisureEndDate?: string;
}
