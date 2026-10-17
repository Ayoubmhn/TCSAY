import { NIL_UUID } from '../common/rules';
import { Injectable } from '@nestjs/common';
import { Category, CategoryFamily, Gender } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { ageAtYearEnd } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

export const MIN_AGE = 4; // provisoire, à confirmer

export type Suggestion =
  | { error: string; age: number }
  | { category: Category; age: number; minor: boolean; alternative: Category | null; referenceYear: number };

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(family?: CategoryFamily) {
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE', archivedAt: null } });
    const categories = await this.prisma.category.findMany({
      where: { family, archivedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { enrollments: { where: { seasonId: season?.id ?? NIL_UUID, player: { archivedAt: null } } } } },
      },
    });
    return categories.map(({ _count, ...c }) => ({ ...c, playersCount: _count.enrollments }));
  }

  /**
   * Catégorie proposée (règle provisoire du prototype, à confirmer avec le bureau) :
   * âge = année de référence − année de naissance, référence = 31/12 de l'année de début de saison.
   */
  async suggest(birthDate: Date, gender: Gender, referenceYear?: number): Promise<Suggestion> {
    const year = referenceYear ?? (await this.access.activeSeason()).startDate.getUTCFullYear();
    const age = ageAtYearEnd(birthDate, year);
    if (age < MIN_AGE) return { error: `Âge ${age} ans : minimum ${MIN_AGE} ans (provisoire).`, age };

    const all = await this.prisma.category.findMany({ where: { archivedAt: null }, orderBy: { sortOrder: 'asc' } });
    const byCode = (code: string) => all.find((c) => c.code === code) ?? null;
    const g = gender === 'F' ? 'F' : 'M';

    if (age < 18) {
      const category = all.find((c) => c.family === 'YOUTH' && c.gender === g && c.maxAge !== null && age < c.maxAge);
      if (category) return { category, age, minor: true, alternative: null, referenceYear: year };
    }
    const category = byCode(g === 'M' ? 'A1M' : 'A1F');
    if (!category) return { error: 'Catégorie adulte introuvable.', age };
    const alternative = age >= 45 ? byCode(`V45${g}`) : age >= 35 ? byCode(`V35${g}`) : null;
    return { category, age, minor: age < 18, alternative, referenceYear: year };
  }
}
