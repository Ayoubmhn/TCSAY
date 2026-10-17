/**
 * Version HTML des emails, aux couleurs du club (design system : cartes arrondies, bordure 1,5px, indigo #5a5acd,
 * Montserrat, sans ombre). Le texte brut reste la source : paragraphes séparés par une ligne vide.
 */
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export type MailAction = { label: string; url: string };

export function renderHtml(subject: string, text: string, action?: MailAction, logoUrl?: string): string {
  const font = "Montserrat, 'Segoe UI', Arial, sans-serif";
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1a1a1a">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = action
    ? `<p style="margin:22px 0 4px"><a href="${escape(action.url)}" style="display:inline-block;background:#5a5acd;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:99px">${escape(action.label)}</a></p>`
    : '';
  const logo = logoUrl
    ? `<img src="${escape(logoUrl)}" width="44" height="44" alt="" style="display:block;border:0">`
    : '';
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 6px 16px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
${logo ? `<td style="padding-right:12px">${logo}</td>` : ''}
<td style="font-family:${font};font-size:16px;font-weight:600;color:#1a1a1a">Tennis Club de Sayada</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border:1.5px solid #e6e6ea;border-radius:24px;padding:28px 26px;font-family:${font}">
<h1 style="margin:0 0 18px;font-size:19px;font-weight:600;color:#1a1a1a">${escape(subject)}</h1>
${paragraphs}${button}
</td></tr>
<tr><td style="padding:16px 6px 0;font-family:${font};font-size:12px;line-height:1.5;color:#8a8a8f">
Email envoyé automatiquement par la plateforme du Tennis Club de Sayada.
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}
