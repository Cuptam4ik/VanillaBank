-- CreateTable
CREATE TABLE "Fine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "issuedByInspectorId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    CONSTRAINT "Fine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Fine_issuedByInspectorId_fkey" FOREIGN KEY ("issuedByInspectorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "finePaymentForId" INTEGER,
    CONSTRAINT "Transaction_senderCardNumber_fkey" FOREIGN KEY ("senderCardNumber") REFERENCES "User" ("cardNumber") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_receiverCardNumber_fkey" FOREIGN KEY ("receiverCardNumber") REFERENCES "User" ("cardNumber") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_finePaymentForId_fkey" FOREIGN KEY ("finePaymentForId") REFERENCES "Fine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("amount", "createdAt", "id", "operationBy", "receiverCardNumber", "senderCardNumber", "type") SELECT "amount", "createdAt", "id", "operationBy", "receiverCardNumber", "senderCardNumber", "type" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_finePaymentForId_key" ON "Transaction"("finePaymentForId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
