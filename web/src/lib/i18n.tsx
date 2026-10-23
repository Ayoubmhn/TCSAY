import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
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
  'Navigation principale': ['Main navigation', 'التنقل الرئيسي'],
  'Menu': ['Menu', 'القائمة'],
  'Séances': ['Sessions', 'الحصص'],
  'Alertes': ['Alerts', 'التنبيهات'],
  'Stats': ['Stats', 'إحصائيات'],
  'Application mobile': ['Mobile app', 'تطبيق الهاتف'],
  'Notifications activées': ['Notifications on', 'الإشعارات مفعّلة'],
  'Notifications bloquées': ['Notifications blocked', 'الإشعارات محظورة'],
  'Notifications désactivées': ['Notifications off', 'الإشعارات غير مفعّلة'],
  'Activer les notifications': ['Turn on notifications', 'تفعيل الإشعارات'],
  'Envoyer un essai': ['Send a test', 'إرسال تجربة'],
  'Notification d’essai envoyée.': ['Test notification sent.', 'تم إرسال إشعار تجريبي.'],
  'Notifications du téléphone': ['Phone notifications', 'إشعارات الهاتف'],
  'Modifier plus tard': ['Change later', 'التغيير لاحقًا'],
  'Version du site': ['Site version', 'إصدار الموقع'],
  'Vous utilisez encore le mot de passe temporaire reçu par email : choisissez le vôtre ci-dessous.': ['You are still using the temporary password received by email: choose your own below.', 'ما زلت تستخدم كلمة المرور المؤقتة المرسلة بالبريد: اختر كلمتك أدناه.'],
  'Notifications indisponibles': ['Notifications unavailable', 'الإشعارات غير متاحة'],
  'Autoriser': ['Allow', 'السماح'],
  'Ouvrir les réglages': ['Open settings', 'فتح الإعدادات'],
  'Ce téléphone reçoit les notifications de votre compte, même application fermée.': ['This phone receives your account notifications, even when the app is closed.', 'يتلقى هذا الهاتف إشعارات حسابك حتى عند إغلاق التطبيق.'],
  'Autorisez les notifications de TCSAY dans les réglages du téléphone, puis revenez ici.': ['Allow TCSAY notifications in the phone settings, then come back here.', 'اسمح بإشعارات TCSAY في إعدادات الهاتف ثم عد إلى هنا.'],
  'Le service de notifications ne répond pas sur ce téléphone. Les notifications restent dans la cloche.': ['The notification service is not responding on this phone. Notifications stay in the bell.', 'خدمة الإشعارات لا تستجيب على هذا الهاتف. تبقى الإشعارات في الجرس.'],
  'Mettez l’application à jour (nouvel APK) pour recevoir les notifications sur le téléphone. En attendant, elles restent dans la cloche.': ['Update the app (new APK) to receive notifications on the phone. Meanwhile they stay in the bell.', 'حدّث التطبيق (APK جديد) لتلقي الإشعارات على الهاتف. في الأثناء تبقى في الجرس.'],
  'Pas de connexion': ['No connection', 'لا يوجد اتصال'],
  'Vérifiez le réseau (Wi-Fi ou données mobiles) : votre session est gardée.': ['Check the network (Wi-Fi or mobile data): your session is kept.', 'تحقق من الشبكة (واي فاي أو بيانات الهاتف): جلستك محفوظة.'],
  'Installer l’application': ['Install the app', 'تثبيت التطبيق'],
  'Stockage sur l’appareil': ['Storage on this device', 'التخزين على الجهاز'],
  'Vider le cache': ['Clear cache', 'مسح الذاكرة المؤقتة'],
  'Nettoyage…': ['Clearing…', 'جارٍ المسح…'],
  'Place utilisée': ['Space used', 'المساحة المستعملة'],
  'Place utilisée inconnue': ['Space used unknown', 'المساحة المستعملة غير معروفة'],
  'pointage(s) en attente d’envoi': ['attendance record(s) waiting to be sent', 'تسجيل(ات) حضور في انتظار الإرسال'],
  'Copies de l’application et des dernières pages consultées, gardées pour ouvrir le site plus vite et sans réseau. Les vider libère de la place ; elles se recréent au fil des visites. Votre session reste ouverte.': ['Copies of the app and of recently viewed pages, kept to open the site faster and offline. Clearing them frees space; they are rebuilt as you browse. You stay signed in.', 'نسخ من التطبيق ومن آخر الصفحات المعروضة، محفوظة لفتح الموقع بسرعة ودون شبكة. مسحها يحرّر مساحة، وتُعاد تلقائيا مع الاستعمال. تبقى متصلا.'],
  'Envoyez d’abord les pointages en attente (avec du réseau) : ils ne sont jamais effacés.': ['Send pending attendance first (with a connection): it is never erased.', 'أرسل أولا تسجيلات الحضور المنتظرة (مع الشبكة): لا تُمسح أبدا.'],
  'Rester connecté': ['Stay signed in', 'البقاء متصلا'],
  '30 jours, appareil personnel': ['30 days, personal device', '30 يوما، جهاز شخصي'],
  Accueil: ['Home', 'الرئيسية'],
  Dashboard: ['Dashboard', 'لوحة القيادة'],
  Utilisateurs: ['Users', 'المستخدمون'],
  Membres: ['Members', 'الأعضاء'],
  Réclamations: ['Complaints', 'الشكاوى'],
  Caisse: ['Cash desk', 'الصندوق'],
  Compétition: ['Competition', 'المنافسات'],
  Communication: ['Communication', 'التواصل'],
  Réglages: ['Settings', 'الإعدادات'],
  Planning: ['Schedule', 'الجدول'],
  'Import Excel des joueurs': ['Excel import of players', 'استيراد اللاعبين من Excel'],
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
  'Découvrez les catégories, garçons et filles réunis par âge.': ['The categories, boys and girls together by age.', 'الفئات، الذكور والإناث معًا حسب السن.'],
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
  Photos: ['Photos', 'الصور'],
  'Albums photos': ['Photo albums', 'ألبومات الصور'],
  'Nouvel événement': ['New event', 'فعالية جديدة'],
  'Je participe': ['I will attend', 'سأشارك'],
  'Je ne participe pas': ['I will not attend', 'لن أشارك'],
  'Participation': ['Attendance', 'المشاركة'],
  'Avec participation': ['With RSVP', 'مع التسجيل'],
  'Affichage seulement': ['Display only', 'للعرض فقط'],
  Rôle: ['Role', 'الدور'],
  Fonction: ['Position', 'الوظيفة'],
  Rémunération: ['Pay', 'الأجر'],
  'Rémunération *': ['Pay *', 'الأجر *'],
  Identifiant: ['Login', 'المعرّف'],
  'Identifiant (email ou CIN)': ['Login (email or ID card no.)', 'المعرّف (البريد أو رقم البطاقة)'],
  'Mot de passe actuel': ['Current password', 'كلمة المرور الحالية'],
  'Mot de passe temporaire': ['Temporary password', 'كلمة المرور المؤقتة'],
  'Nouveau mot de passe (10 caractères, lettres et chiffres)': ['New password (10 characters, letters and digits)', 'كلمة مرور جديدة (10 أحرف، حروف وأرقام)'],
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
  'Le mot de passe doit contenir au moins 10 caractères.': ['The password must contain at least 10 characters.', 'يجب أن تحتوي كلمة المرور على 10 أحرف على الأقل.'],
  'Le mot de passe doit contenir au moins une lettre et un chiffre.': ['The password must contain at least one letter and one digit.', 'يجب أن تحتوي كلمة المرور على حرف ورقم على الأقل.'],
  'Les deux mots de passe ne correspondent pas.': ['The two passwords do not match.', 'كلمتا المرور غير متطابقتين.'],
  'Préférences enregistrées sur cet appareil.': ['Preferences saved on this device.', 'التفضيلات محفوظة على هذا الجهاز.'],
  'Compte fédération (IJIN)': ['Federation account (IJIN)', 'حساب الجامعة (IJIN)'],
  'Identifiant IJIN': ['IJIN login', 'معرف IJIN'],
  'Mot de passe IJIN': ['IJIN password', 'كلمة مرور IJIN'],
  'Nouveau mot de passe IJIN (vide = inchangé)': ['New IJIN password (empty = unchanged)', 'كلمة مرور IJIN جديدة (فارغ = دون تغيير)'],
  'Afficher le mot de passe': ['Show password', 'إظهار كلمة المرور'],
  Masquer: ['Hide', 'إخفاء'],
  Facultatif: ['Optional', 'اختياري'],
  Enregistré: ['Saved', 'محفوظ'],
  'Mot de passe enregistré': ['Password saved', 'كلمة المرور محفوظة'],
  'Compte IJIN enregistré.': ['IJIN account saved.', 'تم حفظ حساب IJIN.'],
  'Compte IJIN retiré.': ['IJIN account removed.', 'تم حذف حساب IJIN.'],
  'Visible par vous seul, chiffré par le club. L’accès direct au site de la fédération viendra plus tard. Identifiant vide = compte retiré.': [
    'Visible to you only, encrypted by the club. Direct access to the federation website will come later. Empty login = account removed.',
    'مرئي لك وحدك ومشفّر من قبل النادي. الدخول المباشر إلى موقع الجامعة لاحقًا. معرف فارغ = حذف الحساب.',
  ],
  // Notifications
  Affichage: ['Display', 'العرض'],
  'Afficher en cases': ['Show as cards', 'عرض كبطاقات'],
  'Afficher en liste': ['Show as list', 'عرض كقائمة'],
  'Trier par': ['Sort by', 'ترتيب حسب'],
  'Envoyer une notification': ['Send a notification', 'إرسال إشعار'],
  'Message du club': ['Club message', 'رسالة النادي'],
  'Messages envoyés': ['Sent messages', 'الرسائل المرسلة'],
  'Nouveau message': ['New message', 'رسالة جديدة'],
  Envoyer: ['Send', 'إرسال'],
  Supprimer: ['Delete', 'حذف'],
  Notifications: ['Notifications', 'الإشعارات'],
  'non lue(s)': ['unread', 'غير مقروءة'],
  'Découvrez les messages du club : paiements, réservations, salaires.': ['Messages from the club: payments, bookings, salaries.', 'رسائل النادي: المدفوعات، الحجوزات، الأجور.'],
  'Tout marquer comme lu': ['Mark all as read', 'تعليم الكل كمقروء'],
  'Marquer comme lu': ['Mark as read', 'تعليم كمقروء'],
  'Non lues': ['Unread', 'غير مقروءة'],
  Toutes: ['All', 'الكل'],
  Afficher: ['Show', 'عرض'],
  Ouvrir: ['Open', 'فتح'],
  'Aucune notification non lue.': ['No unread notifications.', 'لا توجد إشعارات غير مقروءة.'],
  'Aucune notification.': ['No notifications.', 'لا توجد إشعارات.'],
  Salaire: ['Salary', 'أجر'],
  Paiement: ['Payment', 'دفع'],
  Information: ['Information', 'معلومة'],
  // Rôles, espaces et autorisations
  Espace: ['Space', 'الفضاء'],
  Administration: ['Administration', 'الإدارة'],
  Entraîneur: ['Coach', 'مدرب'],
  Président: ['President', 'الرئيس'],
  'Agent superviseur': ['Supervisor', 'عون مراقب'],
  Autorisations: ['Permissions', 'الصلاحيات'],
  'Droits par rôle': ['Rights by role', 'الصلاحيات حسب الدور'],
  'Rôles des comptes': ['Account roles', 'أدوار الحسابات'],
  'Découvrez les droits de chaque rôle et attribuez les rôles des comptes.': ['Rights of each role and account roles.', 'صلاحيات كل دور وأدوار الحسابات.'],
  'Séance en cours': ['Current session', 'الحصة الجارية'],
  'Séances du jour': ['Today’s sessions', 'حصص اليوم'],
  'Découvrez vos séances du jour et pointez la séance en cours.': ['Your sessions today; take attendance for the current one.', 'حصصك اليوم وتسجيل الحضور للحصة الجارية.'],
  Retard: ['Late', 'تأخير'],
  'Enregistrer les présences': ['Save attendance', 'حفظ الحضور'],
  'Séance annulée': ['Session cancelled', 'حصة ملغاة'],
  'Séance physique': ['Physical session', 'حصة بدنية'],
  Remplacement: ['Replacement', 'تعويض'],
  Annulée: ['Cancelled', 'ملغاة'],
  'En cours': ['In progress', 'جارية'],
  Loisirs: ['Leisure', 'ترفيه'],
  Compétitif: ['Competitive', 'تنافسي'],
  'Type de groupe': ['Group type', 'نوع المجموعة'],
  Surface: ['Surface', 'الأرضية'],
  'Terre battue': ['Clay', 'ترابي'],
  Dur: ['Hard', 'صلب'],
  Gazon: ['Grass', 'عشبي'],
  'Séance physique incluse dans ce tarif': ['Physical session included in this fee', 'الحصة البدنية مشمولة في هذه الرسوم'],
  'Historique et statistiques': ['History and statistics', 'السجل والإحصائيات'],
  Statistiques: ['Statistics', 'الإحصائيات'],
  'Découvrez l’historique et les statistiques de la saison.': ['History and statistics of the season.', 'سجل وإحصائيات الموسم.'],
  'Joueurs par catégorie': ['Players by category', 'اللاعبون حسب الفئة'],
  'Effacer les filtres': ['Clear filters', 'مسح التصفية'],
  'Gérer les autorisations': ['Manage permissions', 'إدارة الصلاحيات'],
  // Connexion
  'Se connecter': ['Log in', 'تسجيل الدخول'],
  Connexion: ['Log in', 'تسجيل الدخول'],
  'Les comptes sont créés par l’administrateur du club.': ['Accounts are created by the club administrator.', 'يتم إنشاء الحسابات من طرف مسؤول النادي.'],
  'Informations personnelles modifiables par le club seulement.': [
    'Personal information can only be changed by the club.',
    'لا يمكن تعديل المعلومات الشخصية إلا من طرف النادي.',
  ],
  // Emails
  'Messagerie': ['Messaging', 'المراسلة'],
  'Serveur d’envoi': ['Mail server', 'خادم الإرسال'],
  'File d’envoi': ['Sending queue', 'قائمة الإرسال'],
  'Tester la configuration': ['Test the configuration', 'اختبار الإعدادات'],
  'Envoyer un email de test à': ['Send a test email to', 'إرسال بريد تجريبي إلى'],
  'Envoyer le test': ['Send the test', 'إرسال الاختبار'],
  'Envoyé': ['Sent', 'أُرسل'],
  'Échec': ['Failed', 'فشل'],
  'Renvoyer': ['Resend', 'إعادة الإرسال'],
  'Tous les statuts': ['All statuses', 'كل الحالات'],
  'Envoyés': ['Sent', 'المرسلة'],
  'Échecs': ['Failed', 'الفاشلة'],
  'Aucun email.': ['No emails.', 'لا توجد رسائل.'],
  'Sans authentification': ['No authentication', 'بدون مصادقة'],
  'Sans chiffrement': ['No encryption', 'بدون تشفير'],
  'Production': ['Production', 'الإنتاج'],
  'Mailpit (développement)': ['Mailpit (development)', 'Mailpit (التطوير)'],
  // Reçus
  'Reçus': ['Receipts', 'الوصولات'],
  'Accès après paiement': ['Access after payment', 'الدخول بعد الدفع'],
  'Matchs': ['Matches', 'المباريات'],
  'Exercices': ['Exercises', 'التمارين'],
  'Suivi technique': ['Technical follow-up', 'المتابعة الفنية'],
  'Bilans des joueurs': ['Player reviews', 'تقييمات اللاعبين'],
  'Suivi et progression': ['Follow-up and progress', 'المتابعة والتقدّم'],
  'Statistiques financières': ['Financial statistics', 'الإحصائيات المالية'],
  'Émettre le reçu': ['Issue the receipt', 'إصدار الوصل'],
  'Imprimer sur le carnet': ['Print on the receipt book', 'الطباعة على دفتر الوصولات'],
  'Réimprimer sur le carnet': ['Reprint on the receipt book', 'إعادة الطباعة على الدفتر'],
  'Reçu PDF': ['PDF receipt', 'وصل PDF'],
  'Annuler le reçu': ['Void the receipt', 'إلغاء الوصل'],
  'Encaisser un paiement': ['Collect a payment', 'استخلاص دفعة'],
  'Espèces': ['Cash', 'نقدا'],
  'Chèque': ['Cheque', 'صك'],
  'N° du chèque': ['Cheque number', 'عدد الصك'],
  'Valide': ['Valid', 'صالح'],
  'Annulé': ['Voided', 'ملغى'],
  'Réglage de l’impression sur le carnet': ['Receipt book print settings', 'ضبط الطباعة على الدفتر'],
  'Imprimer une page de test': ['Print a test page', 'طباعة صفحة تجريبية'],
  'Enregistrer le réglage': ['Save settings', 'حفظ الضبط'],
  'Toute l’impression': ['Whole print', 'كامل الطباعة'],
  'Imprimer': ['Print', 'طباعة'],
  'Enregistrer en PDF': ['Save as PDF', 'حفظ PDF'],
  'Tous les reçus': ['All receipts', 'كل الوصولات'],
  'Valides': ['Valid', 'الصالحة'],
  'Annulés': ['Voided', 'الملغاة'],
  // Guide de première utilisation (features/guide)
  'Étape': ['Step', 'الخطوة'],
  'sur': ['of', 'من'],
  'Nouveau': ['New', 'جديد'],
  '(dans le menu, bouton en haut à gauche)': ['(in the menu, top-left button)', '(في القائمة، الزر أعلى اليسار)'],
  'Passer': ['Skip', 'تخطّي'],
  'Passer le guide': ['Skip the guide', 'تخطّي الدليل'],
  '← Retour': ['← Back', '→ رجوع'],
  'Terminer ✓': ['Finish ✓', 'إنهاء ✓'],
  'Commencer': ['Start', 'ابدأ'],
  'Suivant →': ['Next →', '← التالي'],
  'Revoir le guide': ['Replay the guide', 'إعادة عرض الدليل'],
  'Aide': ['Help', 'مساعدة'],
  'Les gestes essentiels de votre espace. Le guide les montre sur les vrais boutons.': ['The key actions of your space. The guide shows them on the real buttons.', 'الحركات الأساسية في فضائك. يعرضها الدليل على الأزرار الحقيقية.'],
  'Bienvenue au TCSAY': ['Welcome to TCSAY', 'مرحبًا بكم في TCSAY'],
  'En 1 minute, on vous montre l’essentiel : paiements, séances, réservation et messages du club.': ['In 1 minute, we show you the essentials: payments, sessions, booking and club messages.', 'في دقيقة واحدة نعرض عليكم الأساسيات: الدفعات، الحصص، الحجز ورسائل النادي.'],
  'Plusieurs enfants ?': ['Several children?', 'أكثر من طفل؟'],
  'Choisissez l’enfant dans la liste en haut de chaque écran : paiements, séances et absences suivent l’enfant choisi.': ['Choose the child in the list at the top of each screen: payments, sessions and absences follow the chosen child.', 'اختاروا الطفل من القائمة أعلى كل شاشة: الدفعات والحصص والغيابات تتبع الطفل المختار.'],
  'Les paiements': ['Payments', 'الدفعات'],
  'Les tranches de la cotisation : payées en vert, à payer en rose, avec la date limite et le n° de vos reçus.': ['The fee instalments: paid in green, due in pink, with the deadline and your receipt numbers.', 'أقساط الاشتراك: المدفوعة بالأخضر، المستحقة بالوردي، مع آخر أجل وأرقام الوصولات.'],
  'Les séances': ['Sessions', 'الحصص'],
  'Les séances à venir et passées. Une séance annulée ou déplacée y est signalée, les absences sont dans « Mes absences ».': ['Upcoming and past sessions. A cancelled or moved session is shown here; absences are in “My absences”.', 'الحصص القادمة والسابقة. تظهر هنا الحصة الملغاة أو المؤجلة، والغيابات في « غياباتي ».'],
  'Choisissez le jour puis un créneau libre (en vert). Annulation possible jusqu’à 24 h avant.': ['Choose the day, then a free slot (in green). Cancellation possible up to 24 h before.', 'اختاروا اليوم ثم موعدًا شاغرًا (بالأخضر). الإلغاء ممكن حتى 24 ساعة قبل.'],
  'Les messages du club': ['Club messages', 'رسائل النادي'],
  'La cloche vous prévient : séance annulée, rappel de paiement, nouveau tournoi, photos. Revoir ce guide : Paramètres › Aide.': ['The bell alerts you: cancelled session, payment reminder, new tournament, photos. Replay this guide: Settings › Help.', 'الجرس ينبّهكم: حصة ملغاة، تذكير بالدفع، دورة جديدة، صور. لإعادة الدليل: الإعدادات › مساعدة.'],
  'L’assiduité, les notes des séances et les bilans de l’entraîneur.': ['Attendance, session ratings and the coach\'s reports.', 'المواظبة وتقييم الحصص وتقارير المدرب.'],
  'Les exercices donnés par l’entraîneur : marquez-les faits.': ['Exercises given by the coach: mark them as done.', 'التمارين التي يقدمها المدرب: علّموا عليها عند إنجازها.'],
  'Disponibilités': ['Availability', 'التوفّر'],
  'Indiquez vos jours et heures libres : le club s’en sert pour placer les groupes.': ['Enter your free days and hours: the club uses them to plan groups.', 'حدّدوا أيامكم وساعاتكم الشاغرة: يستعملها النادي لتنظيم المجموعات.'],
  'En 1 minute, l’essentiel pour vos séances : planning, présences, absences et messages.': ['In 1 minute, the essentials for your sessions: schedule, attendance, absences and messages.', 'في دقيقة واحدة، الأساسيات لحصصكم: الجدول، الحضور، الغيابات والرسائل.'],
  'Vos séances de la semaine, avec le terrain et les remplacements.': ['Your sessions this week, with the court and replacements.', 'حصصكم هذا الأسبوع مع الملعب والتعويضات.'],
  'Les présences': ['Attendance', 'الحضور'],
  'Pendant la séance, pointez présent, en retard ou absent. Sans réseau aussi : le pointage part tout seul au retour du réseau.': ['During the session, mark present, late or absent. Offline too: it is sent automatically when the network returns.', 'أثناء الحصة سجّلوا حاضر أو متأخر أو غائب. حتى دون شبكة: يُرسل التسجيل تلقائيًا عند عودتها.'],
  'Prévenez d’une absence : la direction décide (remplaçant, séance physique ou annulation).': ['Report an absence: the management decides (replacement, fitness session or cancellation).', 'أعلموا بغيابكم: تقرّر الإدارة (معوّض، حصة بدنية أو إلغاء).'],
  'Le bilan de chaque joueur par trimestre et son niveau.': ['Each player\'s term report and level.', 'تقرير كل لاعب حسب الثلاثي ومستواه.'],
  'Votre bibliothèque d’exercices, à donner à un groupe ou à un joueur.': ['Your exercise library, to give to a group or a player.', 'مكتبة تمارينكم لإعطائها لمجموعة أو لاعب.'],
  'Mes disponibilités': ['My availability', 'أوقات توفّري'],
  'Votre semaine type et vos indisponibilités.': ['Your typical week and unavailability.', 'أسبوعكم النموذجي وأوقات عدم توفركم.'],
  'En 1 minute, les écrans de votre travail au club. Le menu ne montre que ce que vos autorisations permettent.': ['In 1 minute, the screens for your work at the club. The menu only shows what your permissions allow.', 'في دقيقة واحدة، شاشات عملكم في النادي. لا تُظهر القائمة إلا ما تسمح به صلاحياتكم.'],
  'Le tableau de bord': ['Dashboard', 'لوحة القيادة'],
  'Les chiffres clés, ce qui reste à traiter et les séances du jour.': ['Key figures, what is left to handle and today\'s sessions.', 'الأرقام الأساسية وما تبقّى للمعالجة وحصص اليوم.'],
  'Les joueurs': ['Players', 'اللاعبون'],
  'Créer un joueur (un parent pour un mineur), son inscription et sa cotisation ; le profil s’ouvre d’un clic sur le nom.': ['Create a player (a parent for a minor), their registration and fee; the profile opens by clicking the name.', 'إنشاء لاعب (وليّ للقاصر) وتسجيله واشتراكه؛ يُفتح الملف بالنقر على الاسم.'],
  'Encaisser une tranche, saisir le n° du reçu du carnet et suivre les retards.': ['Collect an instalment, enter the receipt-book number and follow late payments.', 'استخلاص قسط، إدخال رقم الوصل من الدفتر ومتابعة التأخيرات.'],
  'Le planning': ['Schedule', 'الجدول'],
  'Les séances de la semaine par terrain et par entraîneur, avec les créneaux libres.': ['This week\'s sessions by court and coach, with free slots.', 'حصص الأسبوع حسب الملعب والمدرب، مع المواعيد الشاغرة.'],
  'Envoyer un message': ['Send a message', 'إرسال رسالة'],
  'Un message aux parents, à un groupe ou à des personnes choisies, aussi par email.': ['A message to parents, a group or chosen people, also by email.', 'رسالة إلى الأولياء أو مجموعة أو أشخاص مختارين، وبالبريد الإلكتروني أيضًا.'],
  'Les autorisations': ['Permissions', 'الصلاحيات'],
  'Président : réglez les droits de chaque rôle dans Paramètres › Autorisations, protégées par un code. L’historique des actions garde qui a fait quoi.': ['President: set each role\'s rights in Settings › Permissions, protected by a code. The action history keeps who did what.', 'الرئيس: اضبطوا حقوق كل دور في الإعدادات › الصلاحيات، المحمية برمز. سجلّ العمليات يحفظ من فعل ماذا.'],
  'Les alertes': ['Alerts', 'التنبيهات'],
  'Projets et budget': ['Projects and budget', 'المشاريع والميزانية'],
  'Les devis, la décision du bureau, le budget de la saison et la trésorerie.': ['Quotes, the board\'s decision, the season budget and cash flow.', 'عروض الأسعار وقرار الهيئة وميزانية الموسم والخزينة.'],
  'Les saisons passées : joueurs, recettes et dépenses depuis Excel, Word ou les cahiers.': ['Past seasons: players, income and expenses from Excel, Word or the notebooks.', 'المواسم السابقة: اللاعبون والمداخيل والمصاريف من Excel أو Word أو الكراسات.'],
  'Les bilans par trimestre, le niveau validé par la direction technique et le suivi technique.': ['Term reports, the level validated by the technical director and technical follow-up.', 'تقارير الثلاثي والمستوى المصادق عليه من الإدارة الفنية والمتابعة الفنية.'],
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

type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (text: string) => string;
  /** Langues proposées : sans l'arabe quand le module « arabe » est coupé (version du club). */
  langs: { value: Lang; label: string }[];
};

const I18nContext = createContext<I18n>({ lang: 'fr', setLang: () => undefined, t: (s) => s, langs: LANGS });

const ARABIC_OFF_KEY = 'tcsay-arabe-coupe';

function readArabicOff(): boolean {
  try {
    return localStorage.getItem(ARABIC_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

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
  // Module « arabe » coupé pour cette mise en ligne (GET /modules, public : utile dès la connexion) ; mémorisé
  // sur l'appareil pour le prochain démarrage, même sans réseau.
  const [arabicOff, setArabicOff] = useState(readArabicOff);
  useEffect(() => {
    api
      .get<{ disabled: string[] }>('/modules')
      .then((r) => {
        const off = r.disabled.includes('arabe');
        setArabicOff(off);
        try {
          localStorage.setItem(ARABIC_OFF_KEY, off ? '1' : '0');
        } catch {
          /* non mémorisé */
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (arabicOff && lang === 'ar') setLang('fr');
  }, [arabicOff, lang, setLang]);
  const langs = useMemo(() => (arabicOff ? LANGS.filter((l) => l.value !== 'ar') : LANGS), [arabicOff]);
  const t = useCallback((text: string) => translate(lang, text), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, langs }), [lang, setLang, t, langs]);
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
