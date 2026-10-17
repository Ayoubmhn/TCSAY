import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

/**
 * Web Push fait main (aucune bibliothèque) :
 * - chiffrement du message « aes128gcm » (RFC 8291 / RFC 8188) avec la clé de l'appareil (p256dh, auth) ;
 * - signature VAPID (RFC 8292) : jeton ES256 qui identifie le serveur du club auprès du service de push.
 */

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type Subscription = { endpoint: string; p256dh: string; auth: string };

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/** Nouvelle paire de clés VAPID (P-256) : publique non compressée (65 octets) et privée (32 octets), en base64url. */
export function generateVapidKeys(subject: string): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32)), subject };
}

/** En-tête Authorization VAPID pour l'adresse du service de push (valable 12 h). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys): string {
  const pub = fromB64u(keys.publicKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: keys.subject })));
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${payload}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** Chiffre le message pour un appareil (un seul enregistrement, sans remplissage). */
export function encryptPayload(sub: Subscription, plaintext: Buffer): Buffer {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Envoie un message ; renvoie le statut HTTP du service de push (201 = accepté, 404/410 = abonnement expiré). */
export async function sendWebPush(sub: Subscription, payload: unknown, keys: VapidKeys, ttlSeconds = 24 * 3600): Promise<number> {
  const body = encryptPayload(sub, Buffer.from(JSON.stringify(payload)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(sub.endpoint, keys),
      TTL: String(ttlSeconds),
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  return res.status;
}
