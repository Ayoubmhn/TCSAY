import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { ReceiptsService } from './receipts.service';

class ListQuery {
  @ApiPropertyOptional({ description: 'N° de reçu, nom du joueur ou de la personne' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'VOIDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'VOIDED'])
  status?: 'ACTIVE' | 'VOIDED';
}

class CreateReceiptDto {
  @ApiProperty({ example: 2313, description: 'N° pré-imprimé du carnet' })
  @IsInt({ message: 'N° de reçu : chiffres seulement.' })
  @Min(1, { message: 'N° de reçu invalide.' })
  @Max(99_999_999, { message: 'N° de reçu invalide.' })
  number: number;

  @ApiProperty({ example: 'Mohamed Ben Ali' })
  @IsString()
  @MinLength(2, { message: 'Indiquez le nom de la personne qui paie.' })
  @MaxLength(80)
  payerName: string;

  @ApiProperty({ example: 'ثلاثمائة دينار' })
  @IsString()
  @MinLength(2, { message: 'Indiquez le montant en lettres.' })
  @MaxLength(120)
  amountWords: string;

  @ApiProperty({ example: '1ère tranche' })
  @IsString()
  @MaxLength(40)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  chequeNumber?: string;

  @ApiProperty({ example: '2026-09-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date du reçu invalide.' })
  issuedOn: string;
}

class PrintedDto {
  @IsIn(['CARNET', 'PDF', 'COPY'])
  kind: 'CARNET' | 'PDF' | 'COPY';
}

class VoidDto {
  @IsString()
  @MinLength(3, { message: 'Motif obligatoire pour annuler un reçu.' })
  @MaxLength(200)
  reason: string;
}

class LayoutDto {
  @IsObject()
  layout: Record<string, unknown>;
}

/** Reçus (administration, droit « encaisser les paiements ») : carnet pré-numéroté, PDF, historique. */
@ApiTags('Reçus')
@ApiBearerAuth()
@Perm('payments.collect')
@Controller()
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('receipts')
  list(@Query() q: ListQuery) {
    return this.receipts.list(q);
  }

  @Get('receipts/next-number')
  next() {
    return this.receipts.nextNumber();
  }

  /** Position des champs sur le carnet (mm). */
  @Get('receipts/layout')
  layout() {
    return this.receipts.layout();
  }

  @Put('receipts/layout')
  saveLayout(@CurrentUser() user: AuthUser, @Body() dto: LayoutDto) {
    return this.receipts.saveLayout(user, dto.layout);
  }

  @Get('receipts/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.get(id);
  }

  @Post('receipts/:id/printed')
  @HttpCode(200)
  printed(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PrintedDto) {
    return this.receipts.printed(user, id, dto.kind);
  }

  @Post('receipts/:id/void')
  @HttpCode(200)
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.receipts.void(user, id, dto.reason);
  }

  /** Reçus d'un paiement et valeurs proposées (nom, montant en lettres, tranche, date). */
  @Get('payments/:id/receipt')
  forPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.forPayment(id);
  }

  @Post('payments/:id/receipts')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateReceiptDto) {
    return this.receipts.create(user, id, dto);
  }
}
