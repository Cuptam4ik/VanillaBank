// server.js
const express = require('express');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // Для парсинга JSON тел запросов
app.use(express.static(path.join(__dirname, 'public'))); // Сервируем статику

// Helper function to generate a unique 5-digit card number
async function generateUniqueCardNumber() {
    let cardNumber;
    let isUnique = false;
  
    while (!isUnique) {
      cardNumber = Math.floor(10000 + Math.random() * 90000); // 5-digit number
      const existingUser = await prisma.user.findUnique({
        where: { cardNumber: cardNumber },
      });
      if (!existingUser) {
        isUnique = true;
      }
    }
    return cardNumber;
  }

// --- Middleware для проверки пользователя ---
async function findUser(nickname) {
    if (!nickname) return null;
    return prisma.user.findUnique({ where: { nickname } });
}

async function findUserByCardNumber(cardNumber) {
    if (!cardNumber) return null;
    return prisma.user.findUnique({ where: { cardNumber: parseInt(cardNumber) } });
}

// --- Роуты ---

// Главная страница - отдает HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// "Логин" - просто проверяет/создает пользователя и возвращает его данные
app.post('/api/login', async (req, res) => {
    const { nickname } = req.body;
    if (!nickname) {
        return res.status(400).json({ message: 'Nickname is required' });
    }

    try {
        let user = await prisma.user.findUnique({ where: { nickname: nickname } });
        if (!user) {
            const newCardNumber = await generateUniqueCardNumber();
            user = await prisma.user.create({
                data: { cardNumber: newCardNumber, nickname: nickname, balance: 100 }
            });
            return res.status(201).json({ message: 'New user created', user });
        }
        res.json({ message: 'User logged in', user });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// --- Функции игрока ---
app.post('/api/player/transfer', async (req, res) => {
    const { senderCardNumber, receiverCardNumber, amount } = req.body;
    const transferAmount = parseInt(amount, 10);

    if (!senderCardNumber || !receiverCardNumber || !transferAmount || transferAmount <= 0) {
        return res.status(400).json({ message: 'Invalid transfer data' });
    }
    if (senderCardNumber === receiverCardNumber) {
        return res.status(400).json({ message: 'Cannot transfer to yourself' });
    }

    try {
        const sender = await findUserByCardNumber(senderCardNumber);
        const receiver = await findUserByCardNumber(receiverCardNumber);

        if (!sender) return res.status(404).json({ message: 'Sender not found' });
        if (!receiver) return res.status(404).json({ message: 'Receiver not found' });

        if (sender.balance < transferAmount) {
            return res.status(400).json({ message: 'Insufficient funds' });
        }

        // Транзакция для атомарности
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { cardNumber: parseInt(senderCardNumber) },
                data: { balance: { decrement: transferAmount } },
            });
            await tx.user.update({
                where: { cardNumber: parseInt(receiverCardNumber) },
                data: { balance: { increment: transferAmount } },
            });
        });
        const updatedSender = await findUserByCardNumber(senderCardNumber);
        res.json({ message: `Transferred ${transferAmount} to ${receiverCardNumber}`, senderBalance: updatedSender.balance });
    } catch (error) {
        console.error("Transfer error:", error);
        res.status(500).json({ message: 'Transaction failed' });
    }
});

// --- Функции банкира ---
// Middleware для проверки, является ли запрашивающий банкиром
async function bankerAuth(req, res, next) {
    const { bankerCardNumber } = req.body; // Используем номер карты банкира
    if (!bankerCardNumber) return res.status(401).json({ message: 'Banker card number required' });

    const banker = await findUserByCardNumber(bankerCardNumber);
    if (!banker || !banker.isBanker) {
        return res.status(403).json({ message: 'Access denied: Not a banker or banker not found' });
    }
    req.banker = banker; // Сохраняем банкира в запросе для дальнейшего использования
    next();
}

app.post('/api/banker/deposit', bankerAuth, async (req, res) => {
    const { targetCardNumber, amount } = req.body;
    const depositAmount = parseInt(amount, 10);

    if (!targetCardNumber || !depositAmount || depositAmount <= 0) {
        return res.status(400).json({ message: 'Invalid deposit data' });
    }

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        const updatedUser = await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { balance: { increment: depositAmount } },
        });
        res.json({ message: `Deposited ${depositAmount} to ${targetCardNumber}. New balance: ${updatedUser.balance}` });
    } catch (error) {
        console.error("Deposit error:", error);
        res.status(500).json({ message: 'Deposit failed' });
    }
});

app.post('/api/banker/withdraw', bankerAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    const withdrawAmount = parseInt(amount, 10);

    if (!targetCardNumber || !withdrawAmount || withdrawAmount <= 0) {
        return res.status(400).json({ message: 'Invalid withdrawal data' });
    }

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        if (targetUser.balance < withdrawAmount) {
            return res.status(400).json({ message: 'Insufficient funds' });
        }

        const updatedUser = await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { balance: { decrement: withdrawAmount } },
        });
        res.json({ message: `Withdrew ${withdrawAmount} from ${targetCardNumber}. New balance: ${updatedUser.balance}` });
    } catch (error) {
        console.error("Withdraw error:", error);
        res.status(500).json({ message: 'Withdrawal failed' });
    }
});

app.post('/api/banker/balance', bankerAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Target card number required' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        res.json({ cardNumber: targetUser.cardNumber, balance: targetUser.balance });
    } catch (error) {
        console.error("Get balance error:", error);
        res.status(500).json({ message: 'Failed to get balance' });
    }
});

// --- Функции админа ---
// Middleware для проверки, является ли запрашивающий админом
async function adminAuth(req, res, next) {
    const { adminCardNumber } = req.body; // Используем номер карты банкира
    if (!adminCardNumber) return res.status(401).json({ message: 'Banker card number required' });

    const admin = await findUserByCardNumber(adminCardNumber);
    if (!admin || !admin.isAdmin) {
        return res.status(403).json({ message: 'Access denied: Not an admin or admin not found' });
    }
    req.admin = admin;
    next();
}

app.post('/api/admin/add-banker', adminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Target card number required' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        if (targetUser.isBanker) {
            return res.status(400).json({ message: `${targetCardNumber} is already a banker.` });
        }

        await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { isBanker: true },
        });
        res.json({ message: `${targetCardNumber} is now a banker.` });
    } catch (error) {
        console.error("Add banker error:", error);
        res.status(500).json({ message: 'Failed to add banker' });
    }
});

app.post('/api/admin/remove-banker', adminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Target card number required' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        if (!targetUser.isBanker) {
            return res.status(400).json({ message: `${targetCardNumber} is not a banker.` });
        }

        await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { isBanker: false },
        });
        res.json({ message: `Banker role removed from ${targetCardNumber}.` });
    } catch (error) {
        console.error("Remove banker error:", error);
        res.status(500).json({ message: 'Failed to remove banker' });
    }
});


// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});