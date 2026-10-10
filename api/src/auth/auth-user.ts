import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Espace de travail choisi dans l'application (en-tête « X-Espace ») :
 * un utilisateur qui cumule plusieurs acteurs (ex. directeur technique et entraîneur) bascule d'un espace à l'autre.
 */
export type Space = 'admin' | 'coach' | 'parent' | 'player';

/** Rôle « d'action » correspondant à chaque espace (utilisé par @Roles et par les contrôleurs). */
export const SPACE_ROLE: Record<Space, Role> = { admin: Role.ADMIN, coach: Role.COACH, parent: Role.PARENT, player: Role.PLAYER };

const ADMIN_SPACE_ROLES: Role[] = [Role.PRESIDENT, Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR, Role.ADMIN];

/** Espaces accessibles selon les rôles, dans l'ordre de préférence. */
export function spacesOf(roles: Role[]): Space[] {
  const out: Space[] = [];
  if (roles.some((r) => ADMIN_SPACE_ROLES.includes(r))) out.push('admin');
  if (roles.includes(Role.COACH)) out.push('coach');
  if (roles.includes(Role.PARENT)) out.push('parent');
  if (roles.includes(Role.PLAYER)) out.push('player');
  return out;
}

/** Utilisateur authentifié, attaché à la requête par AuthGuard. */
export type AuthUser = {
  id: string;
  email: string | null;
  /** Rôle d'action de l'espace courant : ADMIN (administration), COACH, PARENT ou PLAYER. */
  role: Role;
  /** Tous les acteurs de l'utilisateur. */
  roles: Role[];
  space: Space;
  spaces: Space[];
  /** Autorisations de l'espace administration (cumul de ses rôles). */
  permissions: string[];
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
  playerId: string | null; // compte joueur
  coachId: string | null; // compte coach
};

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const PERMS = 'perms';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';

/** Route accessible sans connexion. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Espaces autorisés, par leur rôle d'action (par défaut : tout utilisateur connecté). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Espace administration avec au moins une de ces autorisations (le président a tout). */
export const Perm = (...permissions: string[]) => SetMetadata(PERMS, permissions);

/** Route accessible même si le mot de passe temporaire n'a pas encore été changé. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});

/** L'utilisateur a-t-il l'une de ces autorisations ? */
export const can = (user: AuthUser, ...permissions: string[]) => permissions.some((p) => user.permissions.includes(p));
