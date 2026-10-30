-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('GOOGLE', 'GOOGLE_DWD', 'MICROSOFT', 'SMTP', 'SANDBOX');

-- CreateEnum
CREATE TYPE "MailboxStatus" AS ENUM ('ACTIVE', 'PAUSED', 'AUTO_PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CampaignMode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SENT', 'FAILED', 'OPEN', 'CLICK', 'REPLY', 'AUTO_REPLY', 'BOUNCE', 'UNSUBSCRIBE', 'STOPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" "MailboxProvider" NOT NULL,
    "status" "MailboxStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT,
    "secretEnc" TEXT,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "dailyLimit" INTEGER NOT NULL DEFAULT 30,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 8,
    "warmupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "warmupStartedAt" TIMESTAMP(3),
    "warmupStart" INTEGER NOT NULL DEFAULT 5,
    "warmupIncrement" INTEGER NOT NULL DEFAULT 3,
    "signature" TEXT,
    "nextSendAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastInboxCheckAt" TIMESTAMP(3),
    "lastInboxUid" INTEGER,
    "inboxUidValidity" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" "CampaignMode" NOT NULL DEFAULT 'TEST',
    "testFastForward" BOOLEAN NOT NULL DEFAULT true,
    "testRedirectTo" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "windowStart" INTEGER NOT NULL DEFAULT 540,
    "windowEnd" INTEGER NOT NULL DEFAULT 1020,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 20,
    "minGapSeconds" INTEGER NOT NULL DEFAULT 90,
    "maxGapSeconds" INTEGER NOT NULL DEFAULT 270,
    "nextSendAt" TIMESTAMP(3),
    "trackOpens" BOOLEAN NOT NULL DEFAULT true,
    "trackClicks" BOOLEAN NOT NULL DEFAULT true,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnDomainReply" BOOLEAN NOT NULL DEFAULT true,
    "threadFollowUps" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribeFooter" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribeText" TEXT NOT NULL DEFAULT 'If you''d rather not hear from me again, just let me know here: {{unsubscribeUrl}}',
    "importReport" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignContact" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "senderEmail" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextStepAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "content" JSONB,
    "variables" JSONB,
    "threadRootMessageId" TEXT,
    "lastMessageId" TEXT,
    "repliedAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignContactId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "step" INTEGER NOT NULL,
    "mode" "CampaignMode" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "messageIdHeader" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "deliveredTo" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "links" JSONB NOT NULL DEFAULT '[]',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstOpenedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "firstClickedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignContactId" TEXT,
    "messageId" TEXT,
    "url" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "likelyBot" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "lastBeat" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "host" TEXT NOT NULL,
    "info" JSONB,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_email_key" ON "Mailbox"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStep_campaignId_order_key" ON "CampaignStep"("campaignId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "CampaignContact_campaignId_status_nextStepAt_idx" ON "CampaignContact"("campaignId", "status", "nextStepAt");

-- CreateIndex
CREATE INDEX "CampaignContact_mailboxId_status_idx" ON "CampaignContact"("mailboxId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignContact_campaignId_contactId_key" ON "CampaignContact"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_token_key" ON "Message"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Message_messageIdHeader_key" ON "Message"("messageIdHeader");

-- CreateIndex
CREATE INDEX "Message_campaignId_sentAt_idx" ON "Message"("campaignId", "sentAt");

-- CreateIndex
CREATE INDEX "Message_mailboxId_sentAt_idx" ON "Message"("mailboxId", "sentAt");

-- CreateIndex
CREATE INDEX "Event_campaignId_type_createdAt_idx" ON "Event"("campaignId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignContactId_fkey" FOREIGN KEY ("campaignContactId") REFERENCES "CampaignContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_campaignContactId_fkey" FOREIGN KEY ("campaignContactId") REFERENCES "CampaignContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
