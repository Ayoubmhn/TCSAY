import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_PENDING_PASSWORD, AuthUser, IS_PUBLIC, ROLES } from './auth-user';
import { verifyToken } from './jwt';

/** Garde globale : JWT obligatoire (sauf @Public), compte actif, mot de passe changé, rôles (@Roles). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Accès refusé pour votre rôle.');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      mustChangePassword: user.mustChangePassword,
      playerId: user.player?.id ?? null,
      coachId: user.coach?.id ?? null,
    };
    return true;
  }
}
