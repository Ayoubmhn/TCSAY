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
 */
export const FORM_CODE = 'TCSAY-INS-V1';

/** Rangée de cases : une lettre ou un chiffre par case. */
function Boxes({ n, size = 'mm' }: { n: number; size?: 'mm' | 'sm' }) {
  const w = size === 'sm' ? 'w-[5mm]' : 'w-[6mm]';
  return (
    <span className="inline-flex" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`h-[7mm] ${w} border-[0.3mm] border-black ${i ? 'border-s-0' : ''}`} />
      ))}
    </span>
  );
}

/** Date JJ / MM / AAAA en cases. */
function DateBoxes() {
  return (
    <span className="inline-flex items-end gap-[1.5mm]">
      <Boxes n={2} />
      <span className="pb-[1mm]">/</span>
      <Boxes n={2} />
      <span className="pb-[1mm]">/</span>
      <Boxes n={4} />
    </span>
  );
}

function Check({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <span className={`inline-flex gap-[2mm] ${wrap ? 'items-start' : 'items-center whitespace-nowrap'}`}>
      <span aria-hidden="true" className="h-[5mm] w-[5mm] flex-none border-[0.3mm] border-black" />
      {children}
    </span>
  );
}

/** Libellé bilingue : français puis arabe. */
function L({ fr, ar }: { fr: string; ar: string }) {
  return (
    <span className="flex min-w-[34mm] flex-col leading-tight">
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
      <L fr={fr} ar={ar} />
      <div className="flex flex-wrap items-center gap-[4mm]">{children}</div>
    </div>
  );
}

function Block({ n, fr, ar, children }: { n: number; fr: string; ar: string; children: ReactNode }) {
  return (
    <section className="mt-[3mm] border-[0.3mm] border-black px-[4mm] py-[1.5mm]">
      <h2 className="m-0 flex justify-between border-b-[0.3mm] border-black pb-[1.5mm] text-[11pt] font-semibold">
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
    <div dir="ltr" className="a4-sheet relative mx-auto w-[210mm] min-h-[297mm] bg-white px-[14mm] py-[10mm] font-[Montserrat,Arial,sans-serif] text-[10pt] text-black">
      <Mark pos="left-[5mm] top-[5mm]" />
      <Mark pos="right-[5mm] top-[5mm]" />
      <Mark pos="left-[5mm] bottom-[5mm]" />
      <Mark pos="right-[5mm] bottom-[5mm]" />

      <header className="flex items-center gap-[4mm]">
        <img src="/logo-tcsay.png" alt="" className="h-[17mm] w-[17mm] object-contain" />
        <div className="flex-1">
          <div className="text-[15pt] font-semibold leading-tight">Tennis Club de Sayada</div>
          <div className="text-[12pt] font-medium">Fiche d’inscription · Saison {season ?? '20__ / 20__'}</div>
          <div dir="rtl" lang="ar" className="text-[11pt]">
            استمارة تسجيل · نادي التنس بالصيادة
          </div>
        </div>
        <div className="flex flex-col items-end gap-[1mm]">
          <span className="border-[0.3mm] border-black px-[2mm] py-[1mm] font-mono text-[9pt] tracking-wider">{FORM_CODE}</span>
          <span className="text-[8pt]">N° dossier</span>
          <Boxes n={6} size="sm" />
        </div>
      </header>

      <p className="mt-[3mm] mb-0 border-[0.3mm] border-dashed border-black px-[3mm] py-[1.5mm] text-[8.5pt]">
        Écrire en <b>MAJUSCULES</b>, au <b>stylo noir</b>, <b>une lettre par case</b>. Cocher les cases d’une croix ✗. ·{' '}
        <span dir="rtl" lang="ar">
          اكتب بالقلم الأسود، حرف واحد في كل خانة، وضع علامة ✗ في الخانة المناسبة.
        </span>
      </p>

      <Block n={1} fr="Joueur" ar="اللاعب">
        <Row fr="Nom" ar="اللقب">
          <Boxes n={24} />
        </Row>
        <Row fr="Prénom" ar="الاسم">
          <Boxes n={24} />
        </Row>
        <Row fr="Naissance" ar="تاريخ الولادة">
          <DateBoxes />
          <span className="ms-[6mm] inline-flex items-center gap-[4mm]">
            <Check>Garçon · ذكر</Check>
            <Check>Fille · أنثى</Check>
          </span>
        </Row>
        <Row fr="CIN (adulte)" ar="بطاقة التعريف">
          <Boxes n={8} />
          <span className="ms-[4mm] text-[9pt] font-semibold">Téléphone · الهاتف</span>
          <Boxes n={8} />
        </Row>
        <Row fr="Email" ar="البريد الإلكتروني">
          <Boxes n={28} size="sm" />
        </Row>
      </Block>

      <Block n={2} fr="Parent ou tuteur (obligatoire pour un mineur)" ar="الولي (إجباري للقاصر)">
        <Row fr="Nom" ar="اللقب">
          <Boxes n={24} />
        </Row>
        <Row fr="Prénom" ar="الاسم">
          <Boxes n={24} />
        </Row>
        <Row fr="Lien" ar="الصفة">
          <Check>Père · الأب</Check>
          <Check>Mère · الأم</Check>
          <Check>Tuteur · الولي</Check>
        </Row>
        <Row fr="CIN" ar="بطاقة التعريف">
          <Boxes n={8} />
          <span className="ms-[4mm] text-[9pt] font-semibold">Téléphone · الهاتف</span>
          <Boxes n={8} />
        </Row>
        <Row fr="Email" ar="البريد الإلكتروني">
          <Boxes n={28} size="sm" />
        </Row>
      </Block>

      <Block n={3} fr="Inscription" ar="التسجيل">
        <Row fr="Paiement" ar="طريقة الدفع">
          <Check>Comptant · نقدًا دفعة واحدة</Check>
          <Check>Par semestre · كل سداسي</Check>
          <Check>Par mois · شهريًا</Check>
        </Row>
        <Row fr="Déjà inscrit ?" ar="مسجل سابقًا؟">
          <Check>Oui · نعم</Check>
          <Check>Non · لا</Check>
          <span className="ms-[4mm] text-[9pt] font-semibold">Depuis · منذ</span>
          <Boxes n={4} />
        </Row>
      </Block>

      <Block n={4} fr="Autorisation et signature" ar="الموافقة والإمضاء">
        <div className="flex flex-col gap-[1.5mm] py-[1.5mm] text-[8.5pt]">
          <Check wrap>
            J’accepte que le club enregistre ces informations pour la gestion des inscriptions, des séances et des paiements. · أوافق على
            تسجيل هذه المعطيات من طرف النادي.
          </Check>
          <Check wrap>J’autorise la prise de photos lors des activités du club. · أوافق على التقاط الصور خلال أنشطة النادي.</Check>
        </div>
        <div className="flex items-end gap-[6mm] py-[2mm]">
          <span className="inline-flex items-end gap-[2mm]">
            <span className="text-[9pt] font-semibold">Date · التاريخ</span>
            <DateBoxes />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="text-[9pt] font-semibold">Signature (parent pour un mineur) · الإمضاء</span>
            <span className="mt-[1mm] h-[12mm] border-[0.3mm] border-black" />
          </span>
        </div>
      </Block>

      <section className="mt-[3mm] border-[0.3mm] border-dashed border-black px-[4mm] py-[2mm] text-[8.5pt]">
        <b className="text-[9pt]">Cadre réservé au club · خاص بالنادي</b>
        <div className="mt-[2mm] flex flex-wrap items-center gap-[5mm]">
          <span>Catégorie : ____________________</span>
          <span>Groupe : ____________________</span>
          <span className="inline-flex items-center gap-[2mm]">
            Saisi le <DateBoxes />
          </span>
          <span>Par : ____________</span>
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
