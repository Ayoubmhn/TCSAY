/**
 * Emails provisoires des comptes créés à l'import (parents) ou à l'initialisation (entraîneurs) :
 * domaine réservé « .invalid » (RFC 2606), aucun email n'y est jamais envoyé. L'admin les remplace par le vrai email,
 * ce qui envoie les identifiants (voir AccountsService.changeEmail).
 */
export const PLACEHOLDER_DOMAIN = 'a-completer.invalid';
export const isPlaceholderEmail = (email?: string | null) => !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);
