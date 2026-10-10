import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentPlan } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  ValidateNested,
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

/** Parent créé dans le formulaire joueur : nom, prénom, téléphone, email et CIN obligatoires. */
export class NewParentDto {
  @IsString()
  @IsNotEmpty({ message: 'Parent : prénom obligatoire.' })
  @MaxLength(60)
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Parent : nom obligatoire.' })
  @MaxLength(60)
  lastName: string;

  @IsString()
  @IsNotEmpty({ message: 'Parent : téléphone obligatoire.' })
  @MaxLength(30)
  phone: string;

  @IsEmail({}, { message: 'Parent : email invalide.' })
  email: string;

  @Matches(/^[0-9A-Za-z]{6,12}$/, { message: 'Parent : CIN obligatoire (6 à 12 caractères).' })
  cin: string;
}

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

  @ApiPropertyOptional({ description: 'CIN (obligatoire pour un adulte)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^[0-9A-Za-z]{6,12}$/, { message: 'CIN invalide (6 à 12 caractères).' })
  cin?: string;

  @ApiPropertyOptional({ description: 'Parent lié existant (obligatoire pour un mineur, sinon newParent)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'Parent invalide.' })
  parentId?: string;

  @ApiPropertyOptional({ description: 'Parent à créer dans le même formulaire s’il n’est pas dans la liste' })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewParentDto)
  newParent?: NewParentDto;

  @ApiPropertyOptional({ enum: PaymentPlan, description: 'Mode de paiement de la cotisation' })
  @IsOptional()
  @IsEnum(PaymentPlan, { message: 'Mode de paiement : comptant, par semestre ou par mois.' })
  paymentPlan?: PaymentPlan;

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

  @IsOptional()
  @ValidateIf((_, v) => v !== '')
  @Matches(/^[0-9A-Za-z]{6,12}$/, { message: 'CIN invalide (6 à 12 caractères).' })
  cin?: string;
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
