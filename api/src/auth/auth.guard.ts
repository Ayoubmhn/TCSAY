import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_PENDING_PASSWORD, AuthUser, IS_PUBLIC, PERMS, ROLES, Space, SPACE_ROLE, spacesOf } from './auth-user';
import { verifyToken } from './jwt';

/**
 * Garde globale : JWT obligatoire (sauf @Public), compte actif, mot de passe changé,
 * espace courant (en-tête X-Espace) parmi ceux de l'utilisateur, rôles (@Roles) et autorisations (@Perm).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = token ? verifyToken(token) : null;
    if (!payload) throw new UnauthorizedException('Session expirée : reconnectez-vous.');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { player: { select: { id: true } }, coach: { select: { id: true } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Compte désactivé ou introuvable.');

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException('Changez votre mot de passe temporaire pour continuer.');
    }

    const spaces = spacesOf(user.roles);
    const wanted = req.headers['x-espace'] as Space | undefined;
    const space: Space | undefined = wanted && spaces.includes(wanted) ? wanted : spaces[0];
    if (!space) throw new ForbiddenException('Aucun rôle attribué à ce compte : contactez le club.');
    const role = SPACE_ROLE[space];
    const permissions = space === 'admin' ? await this.permissionsService.forRoles(user.roles) : [];

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(role)) {
      throw new ForbiddenException('Accès refusé pour votre rôle.');
    }
    const perms = this.reflector.getAllAndOverride<string[] | undefined>(PERMS, targets);
    if (perms?.length && (space !== 'admin' || !perms.some((p) => permissions.includes(p)))) {
      throw new ForbiddenException('Accès refusé : autorisation manquante (voir le président du club).');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role,
      roles: user.roles,
      space,
      spaces,
      permissions,
      firstName: user.firstName,
      lastName: user.lastName,
      mustChangePassword: user.mustChangePassword,
      playerId: user.player?.id ?? null,
      coachId: user.coach?.id ?? null,
    };
    return true;
  }
}
