-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cardNumber" INTEGER NOT NULL,
    "telegramId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 100,
    "isBanker" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_cardNumber_key" ON "User"("cardNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");
