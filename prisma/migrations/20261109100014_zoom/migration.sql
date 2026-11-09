-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "meetingVideo" TEXT NOT NULL DEFAULT 'LINK';

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "videoId" TEXT;

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "clientId" TEXT,
    "clientSecretEnc" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "accountEmail" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_key" ON "Integration"("provider");
