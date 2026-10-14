// Contrôle du Web Push fait main : chiffrement aes128gcm (RFC 8291) déchiffré comme le ferait le navigateur,
// et signature du jeton VAPID (RFC 8292). Lancer : npm run test:push
const ts = require('typescript');
const fs = require('fs');
const crypto = require('crypto');
const src = fs.readFileSync(require('path').join(__dirname, '../src/push/web-push.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const { generateVapidKeys, vapidAuthorization, encryptPayload } = m.exports;
const b64u = (b) => Buffer.from(b).toString('base64url');
let bad = 0;
const check = (label, ok) => { console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}`); if (!ok) bad++; };

// Abonnement côté « navigateur »
const ua = crypto.createECDH('prime256v1');
const uaPublic = ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: 'https://push.exemple.test/abc', p256dh: b64u(uaPublic), auth: b64u(auth) };

for (const text of ['', 'Bonjour', JSON.stringify({ title: 'TCSAY', body: 'é'.repeat(1500), link: '/paiements' })]) {
  const rec = encryptPayload(sub, Buffer.from(text));
  const salt = rec.subarray(0, 16);
  const rs = rec.readUInt32BE(16);
  const idlen = rec[20];
  const asPublic = rec.subarray(21, 21 + idlen);
  const body = rec.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(body.subarray(body.length - 16));
  let plain;
  try { plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]); } catch { plain = null; }
  check(`déchiffrement (${Buffer.byteLength(text)} octets, rs ${rs}, clé ${idlen})`, plain && plain[plain.length - 1] === 2 && plain.subarray(0, -1).toString() === text && rec.length <= 4096);
}

// Jeton VAPID
const keys = generateVapidKeys('mailto:contact@tcsay.tn');
check('clé publique VAPID 65 octets non compressée', Buffer.from(keys.publicKey, 'base64url').length === 65 && Buffer.from(keys.publicKey, 'base64url')[0] === 4);
const header = vapidAuthorization(sub.endpoint, keys);
const mt = /^vapid t=([^,]+), k=(.+)$/.exec(header);
check('en-tête « vapid t=…, k=… »', Boolean(mt) && mt[2] === keys.publicKey);
const [h, p, s] = mt[1].split('.');
const claims = JSON.parse(Buffer.from(p, 'base64url'));
check('revendications aud / exp / sub', claims.aud === 'https://push.exemple.test' && claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600 && claims.sub === keys.subject);
const pub = Buffer.from(keys.publicKey, 'base64url');
const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
check('signature ES256', crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));

console.log(bad ? `${bad} échec(s)` : 'Web Push : tout est conforme');
process.exit(bad ? 1 : 0);
