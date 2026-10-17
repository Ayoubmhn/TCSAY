import { BadRequestException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { signUrl } from '../auth/jwt';
import { PrismaService } from '../prisma/prisma.service';

/** Photo de profil : 400 × 400 réduite dans le navigateur ; ici 400 Ko au plus. */
export const MAX_PHOTO = 400 * 1024;
const DAY = 86_400_000;

/** Type réel d'après les premiers octets (le nom ou le type annoncé ne suffisent pas). */
export function imageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

type Ref = { id: string; updatedAt: Date };

/**
 * Photos de profil : adresse signée qui expire (fin du lendemain), donc ni devinable ni partageable longtemps ;
 * la balise <img> n'envoie pas le jeton de connexion, d'où la signature dans l'adresse.
 */
@Injectable()
export class PhotosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Adresse relative à l'API (`/photos/…`), à préfixer par `/api/v1` côté site. */
  url(p: Ref | null | undefined): string | null {
    if (!p) return null;
    // Expiration arrondie au jour : la même adresse sert toute la journée (cache du navigateur).
    const exp = Math.ceil((Date.now() + DAY) / DAY) * DAY;
    const v = p.updatedAt.getTime().toString(36);
    return `/photos/${p.id}?v=${v}&e=${exp}&s=${signUrl(`${p.id}.${v}.${exp}`)}`;
  }

  verify(id: string, v: string, e: string, s: string): boolean {
    if (!/^\d+$/.test(e) || Number(e) < Date.now()) return false;
    const expected = Buffer.from(signUrl(`${id}.${v}.${e}`));
    const given = Buffer.from(String(s ?? ''));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Photos de comptes : userId → adresse. */
  async forUsers(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!list.length) return new Map();
    const rows = await this.prisma.profilePhoto.findMany({ where: { userId: { in: list } }, select: { id: true, userId: true, updatedAt: true } });
    return new Map(rows.map((r) => [r.userId!, this.url(r)!]));
  }

  /** Photos de joueurs : photo du joueur, sinon celle de son compte. playerId → adresse. */
  async forPlayers(players: { id: string; userId?: string | null }[]): Promise<Map<string, string>> {
    if (!players.length) return new Map();
    const [own, users] = await Promise.all([
      this.prisma.profilePhoto.findMany({ where: { playerId: { in: players.map((p) => p.id) } }, select: { id: true, playerId: true, updatedAt: true } }),
      this.forUsers(players.map((p) => p.userId)),
    ]);
    const byPlayer = new Map(own.map((r) => [r.playerId!, this.url(r)!]));
    const out = new Map<string, string>();
    for (const p of players) {
      const u = byPlayer.get(p.id) ?? (p.userId ? users.get(p.userId) : undefined);
      if (u) out.set(p.id, u);
    }
    return out;
  }

  /** Contrôle du fichier envoyé (type réel, taille). */
  check(file?: { buffer: Buffer }): { data: Buffer; mime: string } {
    if (!file?.buffer?.length) throw new BadRequestException('Choisissez une photo.');
    if (file.buffer.length > MAX_PHOTO) throw new BadRequestException('Photo trop lourde (400 Ko au plus).');
    const mime = imageType(file.buffer);
    if (!mime) throw new BadRequestException('Photo : JPG, PNG ou WEBP.');
    return { data: file.buffer, mime };
  }
}
