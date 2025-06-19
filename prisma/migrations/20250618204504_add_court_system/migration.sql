-- CreateTable
CREATE TABLE "CourtCase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "reason" TEXT,
    "plaintiffId" INTEGER NOT NULL,
    "defendantId" INTEGER NOT NULL,
    CONSTRAINT "CourtCase_plaintiffId_fkey" FOREIGN KEY ("plaintiffId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourtCase_defendantId_fkey" FOREIGN KEY ("defendantId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourtMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "caseId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourtMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CourtCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourtMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
