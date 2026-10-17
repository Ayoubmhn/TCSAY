/**
 * Liens du site reçus par Android (email, SMS, WhatsApp : https://tcsay.vercel.app/paiements…) : l'application s'ouvre
 * sur l'écran unique (le site dans la vue) avec la page demandée en paramètre `open`.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, 'https://tcsay.local');
    if (!/^https?:$/.test(url.protocol)) return '/';
    const page = `${url.pathname}${url.search}${url.hash}`;
    return page === '/' || !page.startsWith('/') || page.startsWith('//') ? '/' : `/?open=${encodeURIComponent(page)}`;
  } catch {
    return '/';
  }
}
