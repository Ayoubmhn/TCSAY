import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { api } from '../../lib/api';
import type { SeasonLite } from '../../lib/types';

/**
 * Fiche d'inscription A4 à remplir à la main (joueur ou parent), pensée pour la lecture automatique au scan :
 * une lettre par case, cases à cocher carrées, repères d'alignement aux quatre coins, code de modèle en en-tête.
 * Libellés en français et en arabe. Le papier reste noir sur blanc, quel que soit le thème de l'écran.
 *
 * Gabarit (mm) : feuille 210 × 297, marges 14 → zone utile 182 ; cadre de bloc 4 + 4 → 174 ;
 * libellé 34 + écart 3 → 137 pour les cases (22 × 6 = 132 ; 26 × 5 = 130).
 */
export const FORM_CODE = 'TCSAY-INS-V1';

/** Rangée de cases : une lettre ou un chiffre par case (largeur fixe, jamais de retour à la ligne). */
function Boxes({ n, w = 6 }: { n: number; w?: 5 | 6 }) {
  return (
    <span className="inline-flex flex-none" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={`h-[7mm] flex-none border-[0.3mm] border-black ${i ? 'border-s-0' : ''}`}
          style={{ width: `${w}mm` }}
        />
      ))}
    </span>
  );
}

/** Date JJ / MM / AAAA en cases. */
function DateBoxes() {
  return (
    <span className="inline-flex flex-none items-end gap-[1.5mm]">
      <Boxes n={2} w={5} />
      <span className="pb-[1mm]">/</span>
      <Boxes n={2} w={5} />
      <span className="pb-[1mm]">/</span>
      <Boxes n={4} w={5} />
    </span>
  );
}

/** Texte bilingue sur une ligne : français, séparateur, arabe isolé (ponctuation à la bonne place). */
function Bi({ fr, ar, bold = false }: { fr: string; ar: string; bold?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-[1.5mm] ${bold ? 'font-semibold' : ''}`}>
      <span>{fr}</span>
      <span aria-hidden="true">·</span>
      <bdi dir="rtl" lang="ar">
        {ar}
      </bdi>
    </span>
  );
}

function Check({ fr, ar }: { fr: string; ar: string }) {
  return (
    <span className="inline-flex flex-none items-center gap-[2mm] whitespace-nowrap">
      <span aria-hidden="true" className="h-[5mm] w-[5mm] flex-none border-[0.3mm] border-black" />
      <Bi fr={fr} ar={ar} />
    </span>
  );
}

/** Consentement : texte français puis arabe sur deux lignes, case à gauche. */
function Consent({ fr, ar }: { fr: string; ar: string }) {
  return (
    <div className="flex items-start gap-[2mm]">
      <span aria-hidden="true" className="mt-[0.5mm] h-[5mm] w-[5mm] flex-none border-[0.3mm] border-black" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span>{fr}</span>
        <span dir="rtl" lang="ar" className="text-start">
          {ar}
        </span>
      </div>
    </div>
  );
}

/** Libellé de ligne : français au-dessus, arabe dessous ; largeur fixe 34 mm. */
function Label({ fr, ar }: { fr: string; ar: string }) {
  return (
    <span className="flex w-[34mm] flex-none flex-col leading-tight">
      <b className="text-[9.5pt] font-semibold">{fr}</b>
      <span dir="rtl" lang="ar" className="text-[8.5pt]">
        {ar}
      </span>
    </span>
  );
}

function Row({ fr, ar, children }: { fr: string; ar: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-[3mm] py-[1mm]">
      <Label fr={fr} ar={ar} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[4mm] gap-y-[1.5mm]">{children}</div>
    </div>
  );
}

/** Champ secondaire sur la même ligne (ex. téléphone à côté de la CIN). */
function Inline({ fr, ar, children }: { fr: string; ar: string; children: ReactNode }) {
  return (
    <span className="inline-flex flex-none items-center gap-[2mm]">
      <span className="text-[9pt]">
        <Bi fr={fr} ar={ar} bold />
      </span>
      {children}
    </span>
  );
}

function Block({ n, fr, ar, children }: { n: number; fr: string; ar: string; children: ReactNode }) {
  return (
    <section className="mt-[3mm] border-[0.3mm] border-black px-[4mm] py-[1.5mm]">
      <h2 className="m-0 flex justify-between border-b-[0.3mm] border-black pb-[1.2mm] text-[11pt] font-semibold">
        <span>
          {n}. {fr}
        </span>
        <span dir="rtl" lang="ar">
          {ar}
        </span>
      </h2>
      {children}
    </section>
  );
}

/** Repère d'alignement (carré noir plein) pour redresser le scan. */
function Mark({ pos }: { pos: string }) {
  return <span aria-hidden="true" className={`absolute h-[6mm] w-[6mm] bg-black ${pos}`} />;
}

export function RegistrationSheet({ season }: { season?: string }) {
  return (
    <div
      dir="ltr"
      className="a4-sheet relative mx-auto box-border flex h-[297mm] w-[210mm] flex-col overflow-hidden bg-white px-[14mm] pt-[12mm] pb-[13mm] text-[9.5pt] leading-snug text-black"
    >
      <Mark pos="left-[5mm] top-[5mm]" />
      <Mark pos="right-[5mm] top-[5mm]" />
      <Mark pos="left-[5mm] bottom-[5mm]" />
      <Mark pos="right-[5mm] bottom-[5mm]" />

      <header className="flex items-center gap-[4mm]">
        <img src="/logo-tcsay.png" alt="" className="h-[17mm] w-[17mm] flex-none object-contain" />
        <div className="min-w-0 flex-1">
          <div className="text-[15pt] font-semibold leading-tight">Tennis Club de Sayada</div>
          <div className="text-[11.5pt] font-medium">Fiche d’inscription · Saison {season ?? '20__ / 20__'}</div>
          <div dir="rtl" lang="ar" className="text-start text-[11pt]">
            استمارة تسجيل · نادي التنس بالصيادة
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-[1mm]">
          <span className="border-[0.3mm] border-black px-[2mm] py-[1mm] font-mono text-[9pt] tracking-wider">{FORM_CODE}</span>
          <span className="text-[8pt]">
            <Bi fr="N° dossier" ar="رقم الملف" />
          </span>
          <Boxes n={6} w={5} />
        </div>
      </header>

      <div className="mt-[3mm] flex flex-col gap-[0.5mm] border-[0.3mm] border-dashed border-black px-[3mm] py-[1.5mm] text-[8.5pt]">
        <span>
          Écrire en <b>MAJUSCULES</b>, au <b>stylo noir</b>, <b>une lettre par case</b>. Cocher les cases d’une croix ✗.
        </span>
        <span dir="rtl" lang="ar" className="text-start">
          اكتب بالقلم الأسود، حرفًا واحدًا في كل خانة، وضع علامة ✗ في الخانة المناسبة.
        </span>
      </div>

      <Block n={1} fr="Joueur" ar="اللاعب">
        <Row fr="Nom" ar="اللقب">
          <Boxes n={22} />
        </Row>
        <Row fr="Prénom" ar="الاسم">
          <Boxes n={22} />
        </Row>
        <Row fr="Naissance" ar="تاريخ الولادة">
          <DateBoxes />
          <Check fr="Garçon" ar="ذكر" />
          <Check fr="Fille" ar="أنثى" />
        </Row>
        <Row fr="CIN (adulte)" ar="بطاقة التعريف">
          <Boxes n={8} w={5} />
          <Inline fr="Tél." ar="الهاتف">
            <Boxes n={8} w={5} />
          </Inline>
        </Row>
        <Row fr="Email" ar="البريد الإلكتروني">
          <Boxes n={26} w={5} />
        </Row>
      </Block>

      <Block n={2} fr="Parent ou tuteur (obligatoire pour un mineur)" ar="الولي (إجباري للقاصر)">
        <Row fr="Nom" ar="اللقب">
          <Boxes n={22} />
        </Row>
        <Row fr="Prénom" ar="الاسم">
          <Boxes n={22} />
        </Row>
        <Row fr="Lien" ar="الصفة">
          <Check fr="Père" ar="الأب" />
          <Check fr="Mère" ar="الأم" />
          <Check fr="Tuteur" ar="الولي" />
        </Row>
        <Row fr="CIN" ar="بطاقة التعريف">
          <Boxes n={8} w={5} />
          <Inline fr="Tél." ar="الهاتف">
            <Boxes n={8} w={5} />
          </Inline>
        </Row>
        <Row fr="Email" ar="البريد الإلكتروني">
          <Boxes n={26} w={5} />
        </Row>
      </Block>

      <Block n={3} fr="Inscription" ar="التسجيل">
        <Row fr="Paiement" ar="طريقة الدفع">
          <Check fr="Comptant" ar="دفعة واحدة" />
          <Check fr="Par semestre" ar="كل سداسي" />
          <Check fr="Par mois" ar="شهريًا" />
        </Row>
        <Row fr="Déjà inscrit ?" ar="مسجل سابقًا؟">
          <Check fr="Oui" ar="نعم" />
          <Check fr="Non" ar="لا" />
          <Inline fr="Depuis" ar="منذ">
            <Boxes n={4} w={5} />
          </Inline>
        </Row>
      </Block>

      <Block n={4} fr="Autorisation et signature" ar="الموافقة والإمضاء">
        <div className="flex flex-col gap-[1.5mm] py-[1.5mm] text-[8.5pt]">
          <Consent
            fr="J’accepte que le club enregistre ces informations pour gérer les inscriptions, les séances et les paiements."
            ar="أوافق على تسجيل هذه المعطيات من طرف النادي لإدارة التسجيل والحصص والدفوعات."
          />
          <Consent fr="J’autorise la prise de photos lors des activités du club." ar="أوافق على التقاط الصور خلال أنشطة النادي." />
        </div>
        <div className="flex items-end gap-[5mm] pb-[1.5mm]">
          <span className="flex flex-none flex-col gap-[1mm]">
            <span className="text-[9pt]">
              <Bi fr="Date" ar="التاريخ" bold />
            </span>
            <DateBoxes />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[1mm]">
            <span className="text-[9pt]">
              <Bi fr="Signature (parent pour un mineur)" ar="الإمضاء" bold />
            </span>
            <span className="h-[12mm] border-[0.3mm] border-black" />
          </span>
        </div>
      </Block>

      <section className="mt-auto border-[0.3mm] border-dashed border-black px-[4mm] py-[1.5mm] text-[8.5pt]">
        <Bi fr="Cadre réservé au club" ar="خاص بالنادي" bold />
        <div className="mt-[1.5mm] grid grid-cols-[1fr_1fr_auto] items-end gap-x-[4mm]">
          <span className="flex items-end gap-[1.5mm]">
            Catégorie <span className="h-[4mm] flex-1 border-b-[0.3mm] border-black" />
          </span>
          <span className="flex items-end gap-[1.5mm]">
            Groupe <span className="h-[4mm] flex-1 border-b-[0.3mm] border-black" />
          </span>
          <span className="inline-flex items-end gap-[1.5mm]">
            Saisi le <DateBoxes />
          </span>
        </div>
      </section>
    </div>
  );
}

/** Écran admin : aperçu de la fiche A4 et impression (Ctrl+P). */
export function RegistrationFormPage() {
  const season = useQuery({ queryKey: ['seasons', 'active'], queryFn: () => api.get<SeasonLite>('/seasons/active') });
  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Fiche d’inscription (A4)"
          subtitle="Imprimez la fiche, faites-la remplir à la main, puis numérisez-la."
          action={
            <Button variant="primary" onClick={() => window.print()}>
              Imprimer la fiche
            </Button>
          }
        />
        <Note>
          Une lettre par case, au stylo noir : la fiche est prévue pour une lecture automatique au scan (repères aux coins, code{' '}
          {FORM_CODE}). La lecture par IA et la validation humaine viendront avec l’import (sprint 9).
        </Note>
      </div>
      <div className="print-area mt-5 overflow-x-auto rounded-[26px] border-[1.5px] border-line bg-fld p-4">
        <RegistrationSheet season={season.data?.label} />
      </div>
    </>
  );
}
