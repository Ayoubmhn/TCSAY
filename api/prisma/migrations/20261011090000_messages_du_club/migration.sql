-- Messages du club : notifications envoyées par l'administration (ajouts seulement, aucune donnée modifiée).
-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "broadcastId" UUID;

-- CreateTable
CREATE TABLE "NotificationBroadcast" (
    "id" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "audience" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "byEmail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationBroadcast_createdAt_idx" ON "NotificationBroadcast"("createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "NotificationBroadcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationBroadcast" ADD CONSTRAINT "NotificationBroadcast_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Nouveau droit « Envoyer des notifications » accordé à l'agent administratif, seulement si les droits sont déjà
-- installés (sinon l'API installe elle-même les droits par défaut, qui le contiennent).
INSERT INTO "RolePermission" ("role", "permission")
SELECT 'ADMIN_AGENT', 'notifications.send'
WHERE EXISTS (SELECT 1 FROM "RolePermission")
ON CONFLICT DO NOTHING;
