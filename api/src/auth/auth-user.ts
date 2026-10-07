import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/** Utilisateur authentifié, attaché à la requête par AuthGuard. */
export type AuthUser = {
  id: string;
  email: string | null;
  role: Role;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
  playerId: string | null; // compte joueur
  coachId: string | null; // compte coach
};

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';

/** Route accessible sans connexion. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Rôles autorisés (par défaut : tout utilisateur connecté). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Route accessible même si le mot de passe temporaire n'a pas encore été changé. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
