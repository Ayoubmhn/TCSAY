import { Socket, connect } from 'node:net';

/**
 * Client SMTP minimal (sans authentification ni TLS), suffisant pour Mailpit en développement.
 * En production : remplacer par le fournisseur d'emails retenu (point à décider).
 */
export function sendSmtp(options: {
  host: string;
  port: number;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const { host, port, from, to, subject, text } = options;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const body = Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n');
  const message = [
    `From: TCSAY <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodedSubject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '.',
  ].join('\r\n');

  const steps = [`EHLO tcsay.local`, `MAIL FROM:<${from}>`, `RCPT TO:<${to}>`, 'DATA', message, 'QUIT'];

  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host, port });
    socket.setTimeout(5000);
    let step = -1;
    let buffer = '';

    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      // Une réponse SMTP complète se termine par « code espace … \r\n ».
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last) || !buffer.endsWith('\r\n')) return;
      buffer = '';
      const code = Number(last.slice(0, 3));
      if (code >= 400) return fail(new Error(`SMTP ${last}`));
      step += 1;
      if (step < steps.length) socket.write(`${steps[step]}\r\n`);
      else {
        socket.end();
        resolve();
      }
    });
    socket.on('timeout', () => fail(new Error('SMTP : délai dépassé.')));
    socket.on('error', fail);
  });
}
