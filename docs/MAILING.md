# Messagerie (emails) TCSAY

La plateforme envoie ses emails (identifiants, nouveau rôle, inscription, réservations, paiements, salaires, absences d'entraîneur) par **SMTP**, avec un client écrit à la main (`api/src/mail/smtp.ts`, aucune bibliothèque).

## Fonctionnement
- Chaque email est enregistré **« En attente »**, puis envoyé en arrière-plan, un par un. Une action (création de compte, paiement…) n'attend jamais le serveur SMTP. Un échec n'annule pas l'action.
- Statuts : En attente, Envoyé, Échec. L'erreur exacte du serveur est conservée.
- Au redémarrage de l'API, les emails restés en attente repartent.
- Écran **Suivi › Emails envoyés** (droit `emails.view`) :
  - serveur en vigueur (sans le mot de passe) ;
  - compteurs de la file ;
  - **email de test** envoyé tout de suite, avec l'erreur affichée en toast en cas d'échec ;
  - **Renvoyer** un email en échec, ou **Renvoyer les échecs** en une fois.
- Format : texte + HTML aux couleurs du club (logo, carte arrondie, bouton indigo « Se connecter » ou « Ouvrir mon espace »).

## Configuration (`api/.env`, puis redémarrer l'API)
| Variable | Rôle |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | Serveur d'envoi |
| `SMTP_SECURITY` | `tls` (465), `starttls` (587) ou `none` (Mailpit). Vide : déduit du port |
| `SMTP_USER`, `SMTP_PASS` | Compte SMTP. Refusé sans chiffrement, sauf sur la machine locale |
| `MAIL_FROM`, `MAIL_FROM_NAME` | Expéditeur affiché |
| `MAIL_REPLY_TO` | Adresse de réponse, facultative (ex. email du bureau) |
| `APP_URL` | Adresse publique du site web : liens et logo dans les emails |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `false` seulement pour un serveur de test au certificat auto-signé |

**Développement :** Mailpit (`docker compose up -d`) capture tout sur le port 1025. Interface : http://localhost:8025.

## Choisir un fournisseur (production)
1. **Gmail du club** : pour démarrer, environ 500 emails par jour.
   - Activer la validation en 2 étapes, puis créer un **mot de passe d'application** (Compte Google › Sécurité).
   - Régler `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER` = l'adresse Gmail, `SMTP_PASS` = le mot de passe d'application.
   - `MAIL_FROM` doit être cette même adresse Gmail.
2. **Brevo** : gratuit jusqu'à 300 emails par jour, meilleure délivrabilité.
   - Créer un compte, valider l'expéditeur, puis prendre l'identifiant et la clé SMTP.
   - Régler `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`.
3. **Domaine `tennisclubdesayada.tn`**, une fois enregistré :
   - créer la boîte `no-reply@` chez l'hébergeur (port 465) ;
   - ajouter dans le DNS les enregistrements **SPF**, **DKIM** et **DMARC** donnés par l'hébergeur ou par Brevo, sinon les emails arrivent en spam.

**Vérification :** ouvrir *Emails envoyés*, envoyer un test à sa propre adresse, puis contrôler la réception et le dossier spam.

**Sécurité :** ne jamais committer `api/.env`. Le mot de passe SMTP ne sort jamais de l'API : il n'est ni affiché ni journalisé.
