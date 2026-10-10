import { Injectable, OnModuleInit } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PERMISSIONS, EDITABLE_ROLES, PERMISSION_KEYS } from './permissions';

/** Droits par rôle (table RolePermission), gardés en mémoire et rechargés après chaque modification. */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private cache: Map<Role, Set<string>> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Base neuve sans droits : on installe les droits par défaut. */
  async onModuleInit() {
    if ((await this.prisma.rolePermission.count()) === 0) await this.installDefaults();
  }

  async installDefaults() {
    const rows = Object.entries(DEFAULT_PERMISSIONS).flatMap(([role, perms]) => perms!.map((permission) => ({ role: role as Role, permission })));
    await this.prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
    this.cache = null;
  }

  private async load(): Promise<Map<Role, Set<string>>> {
    if (this.cache) return this.cache;
    let rows = await this.prisma.rolePermission.findMany();
    // Table vidée (ex. rechargement des données de démo) : droits par défaut réinstallés.
    if (!rows.length) {
      await this.installDefaults();
      rows = await this.prisma.rolePermission.findMany();
    }
    const map = new Map<Role, Set<string>>();
    for (const r of rows) {
      if (!map.has(r.role)) map.set(r.role, new Set());
      map.get(r.role)!.add(r.permission);
    }
    this.cache = map;
    return map;
  }

  /** Droits cumulés d'un utilisateur selon tous ses rôles. Le président a tout, y compris les autorisations. */
  async forRoles(roles: Role[]): Promise<string[]> {
    if (roles.includes(Role.PRESIDENT) || roles.includes(Role.ADMIN)) return [...PERMISSION_KEYS, 'permissions.manage'];
    const map = await this.load();
    const out = new Set<string>();
    for (const role of roles) for (const p of map.get(role) ?? []) out.add(p);
    return [...out];
  }

  async matrix(): Promise<Record<string, string[]>> {
    const map = await this.load();
    return Object.fromEntries(EDITABLE_ROLES.map((r) => [r, [...(map.get(r) ?? [])].sort()]));
  }

  async set(role: Role, permissions: string[]) {
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { role } }),
      this.prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ role, permission })) }),
    ]);
    this.cache = null;
  }
}
