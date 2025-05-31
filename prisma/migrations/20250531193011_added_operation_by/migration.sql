/*
  Warnings:

  - You are about to drop the column `receiverId` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the column `senderId` on the `Transaction` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "senderCardNumber" INTEGER,
    "receiverCardNumber" INTEGER,
    "amount" INTEGER NOT NULL,
    "operationBy" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Transaction" ("amount", "createdAt", "id", "operationBy", "type") SELECT "amount", "createdAt", "id", "operationBy", "type" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
