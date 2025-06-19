/*
  Warnings:

  - You are about to drop the `RegistrationToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `imageUrl` on the `CourtMessage` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `User` table. All the data in the column will be lost.
  - Made the column `reason` on table `CourtCase` required. This step will fail if there are existing NULL values in that column.
  - Made the column `text` on table `CourtMessage` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "RegistrationToken_token_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RegistrationToken";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "registrationToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CourtCase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "plaintiffId" INTEGER NOT NULL,
    "defendantId" INTEGER NOT NULL,
    "judgeId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closeReason" TEXT,
    CONSTRAINT "CourtCase_plaintiffId_fkey" FOREIGN KEY ("plaintiffId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourtCase_defendantId_fkey" FOREIGN KEY ("defendantId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourtCase_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CourtCase" ("closeReason", "closedAt", "createdAt", "defendantId", "id", "judgeId", "plaintiffId", "reason", "status", "title") SELECT "closeReason", "closedAt", "createdAt", "defendantId", "id", "judgeId", "plaintiffId", "reason", "status", "title" FROM "CourtCase";
DROP TABLE "CourtCase";
ALTER TABLE "new_CourtCase" RENAME TO "CourtCase";
CREATE TABLE "new_CourtMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "caseId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourtMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CourtCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourtMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CourtMessage" ("caseId", "createdAt", "id", "senderId", "text") SELECT "caseId", "createdAt", "id", "senderId", "text" FROM "CourtMessage";
DROP TABLE "CourtMessage";
ALTER TABLE "new_CourtMessage" RENAME TO "CourtMessage";
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cardNumber" INTEGER NOT NULL,
    "nickname" TEXT NOT NULL,
    "password" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "isBanker" BOOLEAN NOT NULL DEFAULT false,
    "isInspector" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isJudge" BOOLEAN NOT NULL DEFAULT false,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenById" INTEGER,
    "registrationToken" TEXT,
    "tokenExpires" DATETIME,
    CONSTRAINT "User_frozenById_fkey" FOREIGN KEY ("frozenById") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
INSERT INTO "new_User" ("balance", "cardNumber", "id", "isAdmin", "isBanker", "isFrozen", "isInspector", "isJudge", "nickname", "password") SELECT "balance", "cardNumber", "id", "isAdmin", "isBanker", "isFrozen", "isInspector", "isJudge", "nickname", "password" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_cardNumber_key" ON "User"("cardNumber");
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");
CREATE UNIQUE INDEX "User_registrationToken_key" ON "User"("registrationToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "registrationToken_token_key" ON "registrationToken"("token");
