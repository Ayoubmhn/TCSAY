import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { hashPassword, verifyPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';
import { LoginThrottle } from '../security/login-throttle';

/** Code de sécurité du module Autorisations : empreinte scrypt dans Setting (jamais le code en clair). */
export const PERMISSIONS_CODE_KEY = 'permissions.code';
export const PERMISSIONS_CODE_HEADER = 'x-code-autorisations';

@Injectable()
export class PermissionsCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async hasCode(): Promise<boolean> {
    return Boolean(await this.prisma.setting.findUnique({ where: { key: PERMISSIONS_CODE_KEY } }));
  }

  async set(code: string): Promise<void> {
    const value = await hashPassword(code);
    await this.prisma.setting.upsert({ where: { key: PERMISSIONS_CODE_KEY }, create: { key: PERMISSIONS_CODE_KEY, value }, update: { value } });
  }

  async check(code: string | undefined): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({ where: { key: PERMISSIONS_CODE_KEY } });
    return Boolean(row && code && (await verifyPassword(code, row.value)));
  }
}

/**
 * Garde du module Autorisations : chaque appel (lecture comme modification) doit porter le code de sécurité dans
 * l'en-tête X-Code-Autorisations. Sans code défini, le module reste fermé jusqu'à sa création (routes /permissions/code*).
 * 5 erreurs de code bloquent 15 minutes (même mécanisme que la connexion).
 */
@Injectable()
export class PermissionsCodeGuard implements CanActivate {
  constructor(
    private readonly codes: PermissionsCodeService,
    private readonly throttle: LoginThrottle,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    if (/\/permissions\/code(-status)?$/.test(req.path)) return true;
    const key = `code-autorisations:${req.user?.id ?? '?'}`;
    this.throttle.check(req.ip ?? '', key);
    const raw = req.headers[PERMISSIONS_CODE_HEADER];
    const code = Array.isArray(raw) ? raw[0] : raw;
    if (await this.codes.check(code)) {
      this.throttle.success(req.ip ?? '', key);
      return true;
    }
    if (code) this.throttle.fail(req.ip ?? '', key);
    throw new ForbiddenException(
      (await this.codes.hasCode()) ? 'Code des autorisations incorrect.' : 'Définissez d’abord le code des autorisations (Paramètres).',
    );
  }
}
