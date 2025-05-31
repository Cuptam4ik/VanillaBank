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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_senderCardNumber_fkey" FOREIGN KEY ("senderCardNumber") REFERENCES "User" ("cardNumber") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_receiverCardNumber_fkey" FOREIGN KEY ("receiverCardNumber") REFERENCES "User" ("cardNumber") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("amount", "createdAt", "id", "operationBy", "receiverCardNumber", "senderCardNumber", "type") SELECT "amount", "createdAt", "id", "operationBy", "receiverCardNumber", "senderCardNumber", "type" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
