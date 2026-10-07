import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../prisma/prisma.service';

export type AuditEntry = {
  action: string; // « Saison activée »
  entity: string; // « Season »
  entityId?: string;
  target: string; // libellé lisible
  before?: string | null;
  after?: string | null;
  reason?: string | null;
};

/** Journal d'audit : qui, quand, avant, après, motif. Lecture seule côté API. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(userId: string | null, entry: AuditEntry, db: Db = this.prisma) {
    return db.auditLog.create({
      data: {
        userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        target: entry.target,
        before: entry.before ?? null,
        after: entry.after ?? null,
        reason: entry.reason?.trim() || null,
      },
    });
  }

  list(limit = 200) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { firstName: true, lastName: true } } },
    });
  }
}
