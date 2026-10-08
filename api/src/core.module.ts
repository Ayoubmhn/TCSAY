import { Global, Module } from '@nestjs/common';
import { AccessService } from './access/access.service';
import { AccountsService } from './accounts/accounts.service';
import { AuditService } from './audit/audit.service';
import { CategoriesService } from './categories/categories.service';
import { MailService } from './mail/mail.service';
import { PermissionsService } from './permissions/permissions.service';
import { SettingsService } from './settings/settings.service';

/** Services transverses disponibles partout : audit, emails, accès, paramètres, comptes, catégories. */
@Global()
@Module({
  providers: [AuditService, MailService, AccessService, SettingsService, AccountsService, CategoriesService, PermissionsService],
  exports: [AuditService, MailService, AccessService, SettingsService, AccountsService, CategoriesService, PermissionsService],
})
export class CoreModule {}
