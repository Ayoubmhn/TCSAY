import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardText } from '../../components/ui/Card';
import { useI18n } from '../../lib/i18n';
import { replayGuide } from './GuideTour';
import { stepsFor } from './steps';

/** Paramètres › Aide : les gestes clés de l'espace (repris du guide) et « Revoir le guide ». */
export function HelpCard() {
  const me = useMe();
  const { t } = useI18n();
  const steps = stepsFor(me).filter((s) => !s.welcome);
  return (
    <Card>
      <CardText keep>{t('Les gestes essentiels de votre espace. Le guide les montre sur les vrais boutons.')}</CardText>
      <ul className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.id} className="rounded-[18px] bg-fld px-4 py-2.5">
            <b className="block text-[14px] font-medium">{t(s.title)}</b>
            <span className="text-[13px] text-mut">{t(s.text)}</span>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="primary" onClick={replayGuide}>
          Revoir le guide
        </Button>
      </div>
    </Card>
  );
}
