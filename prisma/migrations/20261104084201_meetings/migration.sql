-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('BUILT_IN', 'EXTERNAL', 'OFF');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('INTERESTED', 'QUESTION', 'NOT_NOW', 'NOT_INTERESTED', 'UNSUBSCRIBE', 'WRONG_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('SEQUENCE', 'BOOKING_REPLY', 'INVITE');

-- CreateEnum
CREATE TYPE "MeetingSource" AS ENUM ('BOOKING_PAGE', 'CALENDLY', 'CAL_COM', 'CALENDAR_INVITE', 'WEBHOOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('BOOKED', 'HELD', 'NO_SHOW', 'CANCELED');

-- AlterEnum
ALTER TYPE "EnrollmentStatus" ADD VALUE 'MEETING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'BOOKING_LINK_SENT';
ALTER TYPE "EventType" ADD VALUE 'MEETING';
ALTER TYPE "EventType" ADD VALUE 'MEETING_CANCELED';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "autoBookingReply" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bookingMode" "BookingMode" NOT NULL DEFAULT 'BUILT_IN',
ADD COLUMN     "bookingReplyMaxDelay" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "bookingReplyMinDelay" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "bookingReplyText" TEXT NOT NULL DEFAULT 'Hi {{firstName|there}},

Great to hear from you. Here''s a link to pick a time that suits you: {{bookingLink}}

If none of those times work, just reply with a couple that do and I''ll send an invite.

Thanks,
{{senderFirstName}}',
ADD COLUMN     "bookingUrl" TEXT,
ADD COLUMN     "meetingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "meetingDurationMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "meetingEnd" INTEGER NOT NULL DEFAULT 1020,
ADD COLUMN     "meetingHorizonDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "meetingHostEmail" TEXT,
ADD COLUMN     "meetingLocation" TEXT,
ADD COLUMN     "meetingNoticeHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "meetingStart" INTEGER NOT NULL DEFAULT 600,
ADD COLUMN     "meetingTitle" TEXT NOT NULL DEFAULT 'Intro call: {{companyName|you}} × {{senderCompany|us}}';

-- AlterTable
ALTER TABLE "CampaignContact" ADD COLUMN     "bookingReplyDueAt" TIMESTAMP(3),
ADD COLUMN     "bookingReplySentAt" TIMESTAMP(3),
ADD COLUMN     "meetingBookedAt" TIMESTAMP(3),
ADD COLUMN     "replyIntent" "ReplyIntent",
ADD COLUMN     "replyIntentBy" TEXT,
ADD COLUMN     "replyMessageId" TEXT,
ADD COLUMN     "replyText" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "kind" "MessageKind" NOT NULL DEFAULT 'SEQUENCE';

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "campaignContactId" TEXT,
    "mode" "CampaignMode" NOT NULL DEFAULT 'LIVE',
    "source" "MeetingSource" NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'BOOKED',
    "externalId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "title" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "hostEmail" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_externalId_key" ON "Meeting"("externalId");

-- CreateIndex
CREATE INDEX "Meeting_startsAt_idx" ON "Meeting"("startsAt");

-- CreateIndex
CREATE INDEX "Meeting_createdAt_idx" ON "Meeting"("createdAt");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_campaignContactId_fkey" FOREIGN KEY ("campaignContactId") REFERENCES "CampaignContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
