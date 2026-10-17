import { BadGatewayException, HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

/**
 * Client Gemini (Google) fait main : appel HTTPS direct de l'API REST « generateContent », sans bibliothèque.
 * Clé dans `GEMINI_API_KEY` (créée sur https://aistudio.google.com, niveau gratuit), modèle dans `GEMINI_MODEL`.
 * `GEMINI_BASE_URL` ne sert qu'aux tests (faux serveur local).
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest';

export type GeminiImage = { mimeType: string; data: Buffer };

/** Schéma de réponse (sous-ensemble OpenAPI accepté par Gemini : OBJECT, ARRAY, STRING…). */
export type GeminiSchema = {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN';
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  enum?: string[];
};

export const geminiKey = () => process.env.GEMINI_API_KEY?.trim() || null;
export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
const baseUrl = () => (process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string }[] };
};

/** Raison donnée par Google → explication et solution en français (la raison de Google est ajoutée à la fin). */
const HINTS: [RegExp, string][] = [
  [/API_KEY_INVALID|api key not valid/i, 'Clé Gemini invalide : recopiez-la depuis aistudio.google.com dans GEMINI_API_KEY (api/.env), sans espace ni guillemet, puis redémarrez l’API.'],
  [/REFERRER|referer/i, 'La clé est limitée à des sites web : dans console.cloud.google.com › API et services › Identifiants, ouvrez la clé et choisissez « Restrictions relatives aux applications : Aucune » (l’appel vient du serveur, pas du navigateur).'],
  [/IP_ADDRESS|ip address/i, 'La clé est limitée à certaines adresses IP : retirez cette restriction dans Google Cloud › Identifiants, ou ajoutez l’adresse du serveur.'],
  [/SERVICE_DISABLED|has not been used|is disabled/i, 'L’API Gemini (« Generative Language API ») n’est pas activée sur ce projet Google : activez-la dans console.cloud.google.com, ou créez la clé directement depuis aistudio.google.com › Get API key (elle l’active).'],
  [/SERVICE_BLOCKED|API_KEY_SERVICE_BLOCKED|blocked/i, 'La clé n’autorise pas l’API Gemini : dans Google Cloud › Identifiants › Restrictions relatives aux API, ajoutez « Generative Language API » (ou choisissez « Ne pas restreindre la clé »).'],
  [/location is not supported|FAILED_PRECONDITION/i, 'Gemini n’est pas proposé gratuitement depuis le pays du serveur : essayez depuis un serveur hébergé dans un pays pris en charge (ex. Render en Europe) ou activez la facturation du projet.'],
  [/PERMISSION_DENIED|permission/i, 'Accès refusé par Google pour cette clé : créez une nouvelle clé sur aistudio.google.com (Get API key › Create API key) et remplacez GEMINI_API_KEY.'],
];

/** Message clair pour l'administrateur selon l'erreur renvoyée par Google. */
function failure(status: number, body: GeminiResponse | null): HttpException {
  const msg = body?.error?.message ?? '';
  const reasons = (body?.error?.details ?? []).map((d) => d.reason ?? '').join(' ');
  const google = ` (Google : ${[body?.error?.status, reasons, msg.slice(0, 200)].filter(Boolean).join(' · ') || `erreur ${status}`})`;
  if (status === 429 || body?.error?.status === 'RESOURCE_EXHAUSTED') {
    return new HttpException('Limite gratuite de Gemini atteinte : réessayez dans quelques minutes (ou demain si la limite du jour est atteinte).', HttpStatus.TOO_MANY_REQUESTS);
  }
  if (status === 404) return new ServiceUnavailableException(`Modèle Gemini « ${geminiModel()} » introuvable : changez GEMINI_MODEL dans api/.env (bouton « Tester la clé » pour voir les modèles).${google}`);
  if (status === 400 || status === 401 || status === 403) {
    const hint = HINTS.find(([re]) => re.test(`${reasons} ${msg} ${body?.error?.status ?? ''}`))?.[1] ?? 'Accès à Gemini refusé pour cette clé.';
    return new ServiceUnavailableException(`${hint}${google}`);
  }
  return new BadGatewayException(`Gemini indisponible (${status}${msg ? ` : ${msg.slice(0, 160)}` : ''}). Réessayez plus tard.`);
}

/** Test de la clé : liste des modèles disponibles (sans envoyer de photo). */
export async function geminiModels(): Promise<{ name: string; label: string }[]> {
  const key = geminiKey();
  if (!key) throw new ServiceUnavailableException('Lecture par IA non configurée : ajoutez GEMINI_API_KEY dans api/.env puis redémarrez l’API.');
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new BadGatewayException(`Gemini injoignable depuis le serveur : ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => null)) as (GeminiResponse & { models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[] }) | null;
  if (!res.ok) throw failure(res.status, json);
  return (json?.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name ?? ''))
    .map((m) => ({ name: String(m.name).replace(/^models\//, ''), label: m.displayName ?? String(m.name) }));
}

/**
 * Envoie un texte et des images, et renvoie la réponse JSON conforme au schéma (température 0 : lecture, pas
 * d'invention). Lève une erreur claire si la clé manque, si la limite gratuite est atteinte ou si la réponse est vide.
 */
export async function geminiJson<T>(prompt: string, images: GeminiImage[], schema: GeminiSchema, timeoutMs = 120_000): Promise<{ data: T; tokens: number }> {
  const key = geminiKey();
  if (!key) throw new ServiceUnavailableException('Lecture par IA non configurée : ajoutez GEMINI_API_KEY dans api/.env puis redémarrez l’API.');
  const body = {
    contents: [{ role: 'user', parts: [...images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.data.toString('base64') } })), { text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new BadGatewayException(ctrl.signal.aborted ? 'Gemini n’a pas répondu à temps : réessayez avec moins de photos.' : `Gemini injoignable : ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as GeminiResponse | null;
  if (!res.ok) throw failure(res.status, json);
  if (json?.promptFeedback?.blockReason) throw new BadGatewayException(`Photo refusée par Gemini (${json.promptFeedback.blockReason}).`);
  const cand = json?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) throw new BadGatewayException(`Réponse vide de Gemini${cand?.finishReason ? ` (${cand.finishReason})` : ''} : réessayez ou reprenez la photo.`);
  if (cand?.finishReason === 'MAX_TOKENS') throw new BadGatewayException('Page trop longue pour une seule lecture : photographiez-la en deux moitiés.');
  try {
    const tokens = (json?.usageMetadata?.promptTokenCount ?? 0) + (json?.usageMetadata?.candidatesTokenCount ?? 0);
    return { data: JSON.parse(text) as T, tokens };
  } catch {
    throw new BadGatewayException('Réponse de Gemini illisible : réessayez la lecture.');
  }
}
