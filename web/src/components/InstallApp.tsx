import { useI18n } from '../lib/i18n';
import { useInstall } from '../lib/pwa';
import { Button } from './ui/Button';
import { Card, CardText } from './ui/Card';
import { Pill } from './ui/Pill';

/**
 * Installer l'application sur le téléphone (ou l'ordinateur) : bouton direct sur Android / Chrome,
 * marche à suivre sur iPhone (Safari › Partager › « Sur l'écran d'accueil »).
 */
export function InstallApp() {
  const { t } = useI18n();
  const { installed, canPrompt, iosManual, install } = useInstall();
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {installed ? <Pill tone="g">Application installée</Pill> : <Pill tone="s">Pas encore installée</Pill>}
      </div>
      {installed ? (
        <CardText keep>{t('Vous utilisez l’application TCSAY installée sur cet appareil.')}</CardText>
      ) : canPrompt ? (
        <>
          <CardText keep>{t('Ajoutez TCSAY à l’écran d’accueil : ouverture en un geste, plein écran, notifications.')}</CardText>
          <div>
            <Button variant="primary" onClick={() => void install()}>
              Installer l’application
            </Button>
          </div>
        </>
      ) : iosManual ? (
        <CardText keep>
          {t('Sur iPhone : ouvrez ce site dans Safari, touchez Partager (carré avec une flèche) puis « Sur l’écran d’accueil ». Les notifications fonctionnent une fois l’application ajoutée.')}
        </CardText>
      ) : (
        <CardText keep>
          {t('Sur Android : menu ⋮ du navigateur › « Installer l’application » (ou « Ajouter à l’écran d’accueil »). Sur ordinateur : icône d’installation dans la barre d’adresse.')}
        </CardText>
      )}
    </Card>
  );
}
