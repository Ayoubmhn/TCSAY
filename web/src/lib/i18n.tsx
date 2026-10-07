import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setDateLocale } from './format';

/**
 * Traduction faite main (aucune bibliothèque) : le texte français sert de clé.
 * Un texte absent du dictionnaire reste en français. L'arabe passe l'interface de droite à gauche (dir="rtl").
 */
export type Lang = 'fr' | 'en' | 'ar';

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

const STORAGE_KEY = 'tcsay-lang';

/** [anglais, arabe] pour chaque texte français. */
const DICT: Record<string, [string, string]> = {
  // Menus et navigation
  MAIN: ['MAIN', 'الرئيسية'],
  Navigation: ['Navigation', 'التنقل'],
  'Menu principal': ['Main menu', 'القائمة الرئيسية'],
  Accueil: ['Home', 'الرئيسية'],
  Dashboard: ['Dashboard', 'لوحة القيادة'],
  Utilisateurs: ['Users', 'المستخدمون'],
  Joueurs: ['Players', 'اللاعبون'],
  Parents: ['Parents', 'الأولياء'],
  Entraîneurs: ['Coaches', 'المدربون'],
  Personnel: ['Staff', 'الموظفون'],
  Entraînement: ['Training', 'التدريب'],
  Groupes: ['Groups', 'المجموعات'],
  'Absences des entraîneurs': ['Coach absences', 'غيابات المدربين'],
  Catégories: ['Categories', 'الفئات'],
  Saisons: ['Seasons', 'المواسم'],
  Terrains: ['Courts', 'الملاعب'],
  Réservations: ['Bookings', 'الحجوزات'],
  'Tarifs terrains': ['Court rates', 'أسعار الملاعب'],
  Finances: ['Finance', 'المالية'],
  Paiements: ['Payments', 'المدفوعات'],
  'Tarifs d’entraînement': ['Training fees', 'رسوم التدريب'],
  Salaires: ['Salaries', 'الرواتب'],
  Suivi: ['Monitoring', 'المتابعة'],
  'Emails envoyés': ['Sent emails', 'الرسائل المرسلة'],
  'Historique des actions': ['Activity log', 'سجل العمليات'],
  'Import historique': ['Archive import', 'استيراد الأرشيف'],
  'Fiche d’inscription (A4)': ['Registration form (A4)', 'استمارة التسجيل (A4)'],
  'Mon activité': ['My activity', 'نشاطي'],
  'Mes séances': ['My sessions', 'حصصي'],
  'Mes absences': ['My absences', 'غياباتي'],
  'Mes paiements': ['My payments', 'مدفوعاتي'],
  'Mes salaires': ['My salaries', 'رواتبي'],
  'Mes réservations': ['My bookings', 'حجوزاتي'],
  'Réserver un terrain': ['Book a court', 'حجز ملعب'],
  'Réserver (séances privées)': ['Book (private lessons)', 'حجز (حصص خاصة)'],
  'Historique des tournois': ['Tournament history', 'سجل البطولات'],
  'Planning des terrains': ['Court schedule', 'جدول الملاعب'],
  Paramètres: ['Settings', 'الإعدادات'],
  Déconnexion: ['Log out', 'تسجيل الخروج'],
  'À venir': ['Coming soon', 'قريبًا'],
  'Changer de thème': ['Change theme', 'تغيير المظهر'],
  '☾ Sombre': ['☾ Dark', '☾ داكن'],
  '☀ Clair': ['☀ Light', '☀ فاتح'],

  // Sous-titres des écrans
  'Découvrez les joueurs inscrits pour la saison en cours.': ['Players registered for the current season.', 'اللاعبون المسجلون في الموسم الحالي.'],
  'Découvrez les parents et les joueurs qui leur sont liés.': ['Parents and the players linked to them.', 'الأولياء واللاعبون المرتبطون بهم.'],
  'Découvrez les entraîneurs, leurs groupes et leur rémunération.': ['Coaches, their groups and their pay.', 'المدربون ومجموعاتهم وأجورهم.'],
  'Découvrez les agents administratifs et la direction technique.': ['Administrative agents and technical direction.', 'الأعوان الإداريون والإدارة الفنية.'],
  'Découvrez les groupes d’entraînement de la saison en cours.': ['Training groups of the current season.', 'مجموعات التدريب للموسم الحالي.'],
  'Découvrez les 29 catégories, par paires garçon / fille.': ['The 29 categories, in boy / girl pairs.', 'الفئات الـ 29 في أزواج ذكور / إناث.'],
  'Découvrez les saisons du club, de l’historique à la prochaine.': ['Club seasons, from past to next.', 'مواسم النادي من الأرشيف إلى القادم.'],
  'Découvrez les tarifs par catégorie et par groupe.': ['Fees by category and group.', 'الرسوم حسب الفئة والمجموعة.'],
  'Découvrez les tarifs horaires de réservation.': ['Hourly booking rates.', 'أسعار الحجز بالساعة.'],
  'Découvrez les terrains et leur disponibilité.': ['Courts and their availability.', 'الملاعب ومدى توفرها.'],
  'Découvrez les réservations par jour.': ['Bookings by day.', 'الحجوزات حسب اليوم.'],
  'Découvrez les salaires des entraîneurs et du personnel.': ['Coach and staff salaries.', 'رواتب المدربين والموظفين.'],
  'Découvrez les tranches de la saison et encaissez les paiements en espèces.': ['Season instalments and cash payments.', 'أقساط الموسم وتحصيل الدفعات نقدًا.'],
  'Découvrez les emails envoyés par la plateforme.': ['Emails sent by the platform.', 'الرسائل التي أرسلتها المنصة.'],
  'Découvrez qui a fait quoi, jour par jour, pour le compte rendu du mois.': ['Who did what, day by day, for the monthly report.', 'من فعل ماذا، يومًا بيوم، للتقرير الشهري.'],
  'Découvrez les séances et les réservations de chaque terrain, jour par jour.': ['Sessions and bookings of each court, day by day.', 'حصص وحجوزات كل ملعب يومًا بيوم.'],
  'Découvrez vos cotisations et l’état de chaque tranche.': ['Your fees and the status of each instalment.', 'اشتراكاتك وحالة كل قسط.'],
  'Découvrez vos entraînements à venir et passés.': ['Your upcoming and past training sessions.', 'تدريباتك القادمة والسابقة.'],
  'Découvrez les séances manquées cette saison.': ['Sessions missed this season.', 'الحصص الفائتة هذا الموسم.'],
  'Découvrez vos groupes et pointez les présences.': ['Your groups and attendance.', 'مجموعاتك وتسجيل الحضور.'],
  'Découvrez vos salaires à venir et ceux qui vous ont été versés.': ['Your upcoming and paid salaries.', 'رواتبك القادمة والمدفوعة.'],
  'Découvrez les absences déclarées et validez-les.': ['Declared absences, to approve.', 'الغيابات المصرح بها للمصادقة.'],
  'Déclarez une absence : elle est validée par l’administration.': ['Declare an absence: the office approves it.', 'صرّح بغياب: تصادق عليه الإدارة.'],
  'Imprimez la fiche, faites-la remplir à la main, puis numérisez-la.': ['Print the form, have it filled in by hand, then scan it.', 'اطبع الاستمارة واملأها باليد ثم امسحها ضوئيًا.'],
  'Gérez votre compte, votre mot de passe et vos préférences.': ['Manage your account, password and preferences.', 'إدارة حسابك وكلمة المرور والتفضيلات.'],

  // Sections
  Informations: ['Information', 'المعلومات'],
  Groupe: ['Group', 'المجموعة'],
  Absences: ['Absences', 'الغيابات'],
  Enfants: ['Children', 'الأبناء'],
  Historique: ['History', 'السجل'],
  'Historique des salaires': ['Salary history', 'سجل الرواتب'],
  'Salaires enregistrés': ['Recorded salaries', 'الرواتب المسجلة'],
  'En attente de validation': ['Awaiting approval', 'في انتظار المصادقة'],
  Passées: ['Past', 'السابقة'],
  'Tranches à relancer': ['Instalments to chase', 'أقساط للتذكير'],
  Événements: ['Events', 'الفعاليات'],
  'Mon compte': ['My account', 'حسابي'],
  'Mot de passe': ['Password', 'كلمة المرور'],
  Préférences: ['Preferences', 'التفضيلات'],
  Langue: ['Language', 'اللغة'],
  Thème: ['Theme', 'المظهر'],
  Clair: ['Light', 'فاتح'],
  Sombre: ['Dark', 'داكن'],

  // KPI et sous-titres de cartes
  'Joueurs actifs': ['Active players', 'اللاعبون النشطون'],
  'Encaissé cette saison': ['Collected this season', 'المحصّل هذا الموسم'],
  'Tranches en retard': ['Late instalments', 'أقساط متأخرة'],
  'Réservations demain': ['Bookings tomorrow', 'حجوزات الغد'],
  'Actions enregistrées': ['Recorded actions', 'العمليات المسجلة'],
  'Par type d’action': ['By action type', 'حسب نوع العملية'],

  // Boutons
  Annuler: ['Cancel', 'إلغاء'],
  Enregistrer: ['Save', 'حفظ'],
  Modifier: ['Edit', 'تعديل'],
  Fermer: ['Close', 'إغلاق'],
  Valider: ['Approve', 'مصادقة'],
  Refuser: ['Reject', 'رفض'],
  Archiver: ['Archive', 'أرشفة'],
  Restaurer: ['Restore', 'استعادة'],
  Désactiver: ['Deactivate', 'تعطيل'],
  Réactiver: ['Reactivate', 'إعادة التفعيل'],
  Profil: ['Profile', 'الملف الشخصي'],
  Présences: ['Attendance', 'الحضور'],
  Réessayer: ['Retry', 'إعادة المحاولة'],
  'Aujourd’hui': ['Today', 'اليوم'],
  Encaisser: ['Collect', 'تحصيل'],
  'Envoyer un rappel': ['Send a reminder', 'إرسال تذكير'],
  'Marquer versé': ['Mark as paid', 'تحديد كمدفوع'],
  'Enregistrer le salaire': ['Save salary', 'حفظ الراتب'],
  'Gérer les salaires': ['Manage salaries', 'إدارة الرواتب'],
  'Lier un joueur': ['Link a player', 'ربط لاعب'],
  'Ajouter un joueur': ['Add a player', 'إضافة لاعب'],
  'Créer le compte': ['Create account', 'إنشاء الحساب'],
  'Inscrire le joueur': ['Register player', 'تسجيل اللاعب'],
  'J’ai noté': ['Noted', 'تم التدوين'],
  'Changer le mot de passe': ['Change password', 'تغيير كلمة المرور'],
  'Imprimer la fiche': ['Print form', 'طباعة الاستمارة'],
  'Imprimer le compte rendu': ['Print report', 'طباعة التقرير'],
  '+ Nouveau joueur': ['+ New player', '+ لاعب جديد'],
  '+ Nouveau parent': ['+ New parent', '+ ولي جديد'],
  '+ Nouvel entraîneur': ['+ New coach', '+ مدرب جديد'],
  '+ Nouveau membre': ['+ New member', '+ موظف جديد'],
  '+ Déclarer une absence': ['+ Declare an absence', '+ التصريح بغياب'],
  '+ Saisir une absence': ['+ Record an absence', '+ تسجيل غياب'],

  // Champs
  Prénom: ['First name', 'الاسم'],
  'Prénom *': ['First name *', 'الاسم *'],
  Nom: ['Last name', 'اللقب'],
  'Nom *': ['Last name *', 'اللقب *'],
  Email: ['Email', 'البريد الإلكتروني'],
  Téléphone: ['Phone', 'الهاتف'],
  CIN: ['ID card no.', 'رقم بطاقة التعريف'],
  'CIN *': ['ID card no. *', 'رقم بطاقة التعريف *'],
  Genre: ['Gender', 'الجنس'],
  Naissance: ['Birth date', 'تاريخ الولادة'],
  'Date de naissance': ['Birth date', 'تاريخ الولادة'],
  Catégorie: ['Category', 'الفئة'],
  Saison: ['Season', 'الموسم'],
  Mois: ['Month', 'الشهر'],
  Date: ['Date', 'التاريخ'],
  Statut: ['Status', 'الحالة'],
  Compte: ['Account', 'الحساب'],
  Rôle: ['Role', 'الدور'],
  Fonction: ['Position', 'الوظيفة'],
  Rémunération: ['Pay', 'الأجر'],
  'Rémunération *': ['Pay *', 'الأجر *'],
  Identifiant: ['Login', 'المعرّف'],
  'Identifiant (email ou CIN)': ['Login (email or ID card no.)', 'المعرّف (البريد أو رقم البطاقة)'],
  'Mot de passe actuel': ['Current password', 'كلمة المرور الحالية'],
  'Mot de passe temporaire': ['Temporary password', 'كلمة المرور المؤقتة'],
  'Nouveau mot de passe (8 caractères minimum)': ['New password (at least 8 characters)', 'كلمة مرور جديدة (8 أحرف على الأقل)'],
  Confirmation: ['Confirmation', 'التأكيد'],
  'Compte créé le': ['Account created on', 'تاريخ إنشاء الحساب'],
  'Dernière connexion': ['Last login', 'آخر دخول'],
  'Mode de paiement': ['Payment method', 'طريقة الدفع'],
  'Montant (DT)': ['Amount (TND)', 'المبلغ (د.ت)'],
  'Note (facultatif)': ['Note (optional)', 'ملاحظة (اختياري)'],
  Acteur: ['Actor', 'الفاعل'],
  'Type de personnel': ['Staff type', 'نوع الموظف'],
  'Agents administratifs': ['Administrative agents', 'الأعوان الإداريون'],
  'Directeur technique': ['Technical director', 'المدير الفني'],
  'Mois précédent': ['Previous month', 'الشهر السابق'],
  'Mois suivant': ['Next month', 'الشهر التالي'],
  'Semaine précédente': ['Previous week', 'الأسبوع السابق'],
  'Semaine suivante': ['Next week', 'الأسبوع التالي'],
  Rechercher: ['Search', 'بحث'],
  'Filtrer par catégorie': ['Filter by category', 'تصفية حسب الفئة'],

  // États et pastilles
  'Chargement…': ['Loading…', 'جارٍ التحميل…'],
  Actif: ['Active', 'نشط'],
  Désactivé: ['Deactivated', 'معطّل'],
  Archivé: ['Archived', 'مؤرشف'],
  Mineur: ['Minor', 'قاصر'],
  Versé: ['Paid', 'مدفوع'],
  'À verser': ['To pay', 'للدفع'],
  'À payer': ['To pay', 'للدفع'],
  Payée: ['Paid', 'مدفوع'],
  Partiel: ['Partial', 'جزئي'],
  'En retard': ['Late', 'متأخر'],
  Estimation: ['Estimate', 'تقدير'],
  Validée: ['Approved', 'مصادق عليه'],
  Refusée: ['Rejected', 'مرفوض'],
  'En attente': ['Pending', 'قيد الانتظار'],
  Présent: ['Present', 'حاضر'],
  Absent: ['Absent', 'غائب'],
  Confirmée: ['Confirmed', 'مؤكدة'],
  'Sans groupe': ['No group', 'بدون مجموعة'],
  'Entraîneur à affecter': ['Coach to assign', 'مدرب يُعيَّن لاحقًا'],
  Réservation: ['Booking', 'حجز'],
  'Entraîneur absent': ['Coach absent', 'المدرب غائب'],

  // États vides
  'Aucun joueur.': ['No players.', 'لا يوجد لاعبون.'],
  'Aucun parent.': ['No parents.', 'لا يوجد أولياء.'],
  'Aucun entraîneur.': ['No coaches.', 'لا يوجد مدربون.'],
  'Aucun membre du personnel.': ['No staff members.', 'لا يوجد موظفون.'],
  'Aucun groupe.': ['No groups.', 'لا توجد مجموعات.'],
  'Aucune absence.': ['No absences.', 'لا توجد غيابات.'],
  'Aucune absence. Bravo !': ['No absences. Well done!', 'لا غيابات. أحسنت!'],
  'Aucun salaire enregistré.': ['No salary recorded.', 'لا توجد رواتب مسجلة.'],
  'Aucune séance à venir.': ['No upcoming sessions.', 'لا توجد حصص قادمة.'],
  'Aucune séance passée.': ['No past sessions.', 'لا توجد حصص سابقة.'],
  'Aucune action ce mois-ci.': ['No actions this month.', 'لا توجد عمليات هذا الشهر.'],
  'Aucune tranche en retard.': ['No late instalments.', 'لا توجد أقساط متأخرة.'],
  'Aucun événement pour le moment.': ['No events yet.', 'لا توجد فعاليات حاليًا.'],
  'Page introuvable': ['Page not found', 'الصفحة غير موجودة'],

  // Rôles
  Administrateur: ['Administrator', 'مسؤول'],
  Coach: ['Coach', 'مدرب'],
  Parent: ['Parent', 'ولي'],
  Joueur: ['Player', 'لاعب'],
  'Agent administratif': ['Administrative agent', 'عون إداري'],

  // Paramètres
  'Mot de passe enregistré.': ['Password saved.', 'تم حفظ كلمة المرور.'],
  'Saisissez votre mot de passe actuel.': ['Enter your current password.', 'أدخل كلمة المرور الحالية.'],
  'Le mot de passe doit contenir au moins 8 caractères.': ['The password must contain at least 8 characters.', 'يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل.'],
  'Les deux mots de passe ne correspondent pas.': ['The two passwords do not match.', 'كلمتا المرور غير متطابقتين.'],
  'Préférences enregistrées sur cet appareil.': ['Preferences saved on this device.', 'التفضيلات محفوظة على هذا الجهاز.'],
  // Connexion
  'Se connecter': ['Log in', 'تسجيل الدخول'],
  Connexion: ['Log in', 'تسجيل الدخول'],
  'Les comptes sont créés par l’administrateur du club.': ['Accounts are created by the club administrator.', 'يتم إنشاء الحسابات من طرف مسؤول النادي.'],
  'Informations personnelles modifiables par le club seulement.': [
    'Personal information can only be changed by the club.',
    'لا يمكن تعديل المعلومات الشخصية إلا من طرف النادي.',
  ],
};

const INDEX: Record<Lang, number> = { fr: -1, en: 0, ar: 1 };

export function translate(lang: Lang, text: string): string {
  if (lang === 'fr') return text;
  return DICT[text]?.[INDEX[lang]] ?? text;
}

function readLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'ar' ? v : 'fr';
  } catch {
    return 'fr';
  }
}

/** Langue et sens d'écriture sur <html> (appelé avant le premier rendu puis à chaque changement). */
export function applyLang(lang: Lang = readLang()): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  setDateLocale(lang);
}

type I18n = { lang: Lang; setLang: (lang: Lang) => void; t: (text: string) => string };

const I18nContext = createContext<I18n>({ lang: 'fr', setLang: () => undefined, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  useEffect(() => applyLang(lang), [lang]);
  const setLang = useCallback((next: Lang) => {
    applyLang(next);
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* préférence non mémorisée */
    }
  }, []);
  const t = useCallback((text: string) => translate(lang, text), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
    // Remontage à chaque changement de langue : dates et libellés calculés hors contexte sont refaits.
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);

/** Traduit un nœud s'il s'agit d'un simple texte (les contenus composés restent tels quels). */
export function useTr() {
  const { t } = useI18n();
  return (node: ReactNode): ReactNode => (typeof node === 'string' ? t(node) : node);
}
