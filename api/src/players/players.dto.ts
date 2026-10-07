import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

export class CreatePlayerDto {
  @IsString()
  @IsNotEmpty({ message: 'Prénom et nom sont obligatoires.' })
  @MaxLength(60)
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Prénom et nom sont obligatoires.' })
  @MaxLength(60)
  lastName: string;

  @Matches(DATE, { message: 'La date de naissance est obligatoire.' })
  birthDate: string;

  @IsIn(['M', 'F'], { message: 'Le genre est obligatoire.' })
  gender: 'M' | 'F';

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ description: 'Parent lié (obligatoire pour un mineur)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'Parent invalide.' })
  parentId?: string;

  @ApiPropertyOptional({ description: 'Catégorie choisie (sinon catégorie proposée)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'Catégorie invalide.' })
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Motif de dérogation si la catégorie diffère de la proposition' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  derogationReason?: string;
}

export class UpdatePlayerDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @Matches(DATE, { message: 'Date de naissance invalide.' })
  birthDate?: string;

  @IsOptional()
  @IsIn(['M', 'F'])
  gender?: 'M' | 'F';

  @IsOptional()
  @ValidateIf((_, v) => v !== '')
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

/** R3 : changement de catégorie par l'admin, motif si hors norme. */
export class ChangeCategoryDto {
  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  derogationReason?: string;
}

/** R9 : ce que le joueur ou le parent peut modifier lui-même. */
export class UpdateContactDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== '')
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class ListPlayersQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  archived?: boolean;
}
