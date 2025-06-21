-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_frozenById_fkey" FOREIGN KEY ("frozenById") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
INSERT INTO "new_User" ("balance", "cardNumber", "frozenById", "id", "isAdmin", "isBanker", "isFrozen", "isInspector", "isJudge", "nickname", "password", "registrationToken", "tokenExpires") SELECT "balance", "cardNumber", "frozenById", "id", "isAdmin", "isBanker", "isFrozen", "isInspector", "isJudge", "nickname", "password", "registrationToken", "tokenExpires" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_cardNumber_key" ON "User"("cardNumber");
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");
CREATE UNIQUE INDEX "User_registrationToken_key" ON "User"("registrationToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
