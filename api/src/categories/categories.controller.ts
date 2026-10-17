import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CategoryFamily, Gender } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, Matches } from 'class-validator';
import { dayFromIso } from '../common/dates';
import { CategoriesService } from './categories.service';

class SuggestQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthDate attendu au format AAAA-MM-JJ.' })
  birthDate: string;

  @IsIn(['M', 'F'], { message: 'Genre M ou F.' })
  gender: Gender;
}

class ListQuery {
  @IsOptional()
  @IsEnum(CategoryFamily)
  family?: CategoryFamily;
}

@ApiTags('Catégories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiQuery({ name: 'family', enum: CategoryFamily, required: false })
  list(@Query() q: ListQuery) {
    return this.categories.list(q.family);
  }

  /** Catégorie proposée en direct dans le formulaire joueur. */
  @Get('suggest')
  suggest(@Query() q: SuggestQuery) {
    return this.categories.suggest(dayFromIso(q.birthDate), q.gender);
  }
}
