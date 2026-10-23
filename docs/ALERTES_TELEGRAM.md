# Alertes du serveur sur Telegram

Le serveur vous prévient sur votre téléphone **avant que le club ne remarque un problème**. Aucune bibliothèque : l'API appelle directement l'API des bots Telegram (`api/src/alerts/`).

## Ce que vous recevez
| Alerte | Quand |
|---|---|
| 🔴 Erreur du serveur (500) | Un bug dans une route : adresse (sans paramètres), compte concerné (identifiant, pas le nom), erreur et ligne du code. Les refus normaux (400, 403, 404, 409…) ne sont **pas** signalés. |
| 🔴 Page du site en erreur | Un écran du site s'est planté chez un utilisateur (« Cette page ne s'est pas ouverte ») : page, téléphone / ordinateur / application, erreur. Les coupures de réseau ne comptent pas. |
| 🔴 Base de données injoignable | Vérifiée toutes les 10 min ; 🟢 message quand elle revient. |
| 🔴 Erreur non traitée / serveur arrêté / ne démarre pas | Plantage du processus (l'hébergeur le relance tout seul). |
| 🟢 Serveur démarré | À chaque démarrage : un redémarrage que vous n'avez pas fait = un plantage. |
| 🟠 Email non envoyé, file d'emails bloquée | Réglage mail cassé, emails en attente depuis plus de 30 min. |
| 🟢 / 🟠 Résumé du jour (8 h) | Erreurs de la veille, emails en échec : « tout va bien » ou « à regarder ». |

**Une même alerte n'est envoyée qu'une fois par 10 minutes** (les répétitions sont comptées), 30 alertes par heure au plus, 10 pour les pages du site.

**Aucune donnée personnelle** : adresses sans paramètres, emails et numéros de téléphone remplacés par `<email>` / `<numéro>`, aucun nom.

## Réglage (5 minutes)
1. Telegram › chercher **@BotFather** › `/newbot` › nom « TCSAY Alertes », identifiant (ex. `tcsay_alertes_bot`). Il donne un **jeton** (`123456:ABC…`) : c'est un secret, ne l'envoyez à personne.
2. Ouvrir votre bot et lui écrire `/start` (sinon il ne peut pas vous écrire).
3. Trouver votre **identifiant de conversation** : ouvrir `https://api.telegram.org/bot<JETON>/getUpdates` dans le navigateur, chercher `"chat":{"id":123456789` → `123456789`. Pour un groupe (vous + un collègue) : ajouter le bot au groupe, y écrire un message, l'identifiant commence par `-`.
4. Mettre les deux valeurs :
   - en local : `api/.env` › `TELEGRAM_BOT_TOKEN=…` et `TELEGRAM_CHAT_ID=…` ;
   - sur Render : tcsay-demo › Environment › mêmes noms › **Save** (redémarrage).
5. Vérifier : le message 🟢 « Serveur démarré » arrive. Ou Swagger › `POST /alerts/test` (président) ; `POST /alerts/summary` envoie le résumé tout de suite.

Réglages facultatifs : `ALERT_INSTANCE` (nom dans les messages : « TCSAY démo », « TCSAY club »), `ALERT_ON_START=false`, `ALERT_MAIL=false` (démo sans emails).

## Serveur complètement arrêté
Un serveur arrêté ne peut pas envoyer d'alerte lui-même. **UptimeRobot** (gratuit) le fait :
1. uptimerobot.com › My Settings › **Alert Contacts** › Add › **Telegram** › suivre le lien de leur bot et `/start`.
2. New monitor › HTTP(s) › `https://tcsay-demo.onrender.com/api/v1/health` › toutes les 10 min › cocher le contact Telegram.

Vous recevez alors « Down » / « Up » sur le même téléphone (et le serveur gratuit reste éveillé).

## Tester sans Telegram
`cd api && npm run build && E2E_DATABASE_URL=<base de démo> npm run test:alerts` : un faux serveur Telegram local reçoit les messages (démarrage, page en erreur sans données personnelles, répétitions groupées, erreur 500 du filtre, message d'essai et résumé réservés au président).
