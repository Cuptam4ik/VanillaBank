-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CourtCase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "reason" TEXT,
    "plaintiffId" INTEGER NOT NULL,
    "defendantId" INTEGER NOT NULL,
    "judgeId" INTEGER,
    "closeReason" TEXT,
    CONSTRAINT "CourtCase_plaintiffId_fkey" FOREIGN KEY ("plaintiffId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourtCase_defendantId_fkey" FOREIGN KEY ("defendantId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourtCase_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CourtCase" ("closedAt", "createdAt", "defendantId", "id", "plaintiffId", "reason", "status", "title") SELECT "closedAt", "createdAt", "defendantId", "id", "plaintiffId", "reason", "status", "title" FROM "CourtCase";
DROP TABLE "CourtCase";
ALTER TABLE "new_CourtCase" RENAME TO "CourtCase";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
