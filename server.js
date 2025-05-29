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

// --- Middleware для проверки пользователя ---
// Простая проверка, что пользователь существует. В реальном приложении была бы аутентификация.
async function findUser(nickname) {
    if (!nickname) return null;
    return prisma.user.findUnique({ where: { nickname } });
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
        let user = await prisma.user.findUnique({ where: { nickname } });
        if (!user) {
            user = await prisma.user.create({
                data: { nickname, balance: 100 } // Новый игрок получает 100
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
    const { senderNickname, receiverNickname, amount } = req.body;
    const transferAmount = parseInt(amount, 10);

    if (!senderNickname || !receiverNickname || !transferAmount || transferAmount <= 0) {
        return res.status(400).json({ message: 'Invalid transfer data' });
    }
    if (senderNickname === receiverNickname) {
        return res.status(400).json({ message: 'Cannot transfer to yourself' });
    }

    try {
        const sender = await findUser(senderNickname);
        const receiver = await findUser(receiverNickname);

        if (!sender) return res.status(404).json({ message: 'Sender not found' });
        if (!receiver) return res.status(404).json({ message: 'Receiver not found' });

        if (sender.balance < transferAmount) {
            return res.status(400).json({ message: 'Insufficient funds' });
        }

        // Транзакция для атомарности
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { nickname: senderNickname },
                data: { balance: { decrement: transferAmount } },
            });
            await tx.user.update({
                where: { nickname: receiverNickname },
                data: { balance: { increment: transferAmount } },
            });
        });
        const updatedSender = await findUser(senderNickname);
        res.json({ message: `Transferred ${transferAmount} to ${receiverNickname}`, senderBalance: updatedSender.balance });
    } catch (error) {
        console.error("Transfer error:", error);
        res.status(500).json({ message: 'Transaction failed' });
    }
});

// --- Функции банкира ---
// Middleware для проверки, является ли запрашивающий банкиром
async function bankerAuth(req, res, next) {
    const { bankerNickname } = req.body; // Предполагаем, что банкир передает свой ник
    if (!bankerNickname) return res.status(401).json({ message: 'Banker nickname required' });

    const banker = await findUser(bankerNickname);
    if (!banker || !banker.isBanker) {
        return res.status(403).json({ message: 'Access denied: Not a banker or banker not found' });
    }
    req.banker = banker; // Сохраняем банкира в запросе для дальнейшего использования
    next();
}

app.post('/api/banker/deposit', bankerAuth, async (req, res) => {
    const { targetNickname, amount } = req.body;
    const depositAmount = parseInt(amount, 10);

    if (!targetNickname || !depositAmount || depositAmount <= 0) {
        return res.status(400).json({ message: 'Invalid deposit data' });
    }

    try {
        const targetUser = await findUser(targetNickname);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        const updatedUser = await prisma.user.update({
            where: { nickname: targetNickname },
            data: { balance: { increment: depositAmount } },
        });
        res.json({ message: `Deposited ${depositAmount} to ${targetNickname}. New balance: ${updatedUser.balance}` });
    } catch (error) {
        console.error("Deposit error:", error);
        res.status(500).json({ message: 'Deposit failed' });
    }
});

app.post('/api/banker/withdraw', bankerAuth, async (req, res) => {
    const { targetNickname, amount } = req.body;
    const withdrawAmount = parseInt(amount, 10);

    if (!targetNickname || !withdrawAmount || withdrawAmount <= 0) {
        return res.status(400).json({ message: 'Invalid withdrawal data' });
    }

    try {
        const targetUser = await findUser(targetNickname);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        if (targetUser.balance < withdrawAmount) {
            return res.status(400).json({ message: 'Target user has insufficient funds for withdrawal' });
        }

        const updatedUser = await prisma.user.update({
            where: { nickname: targetNickname },
            data: { balance: { decrement: withdrawAmount } },
        });
        res.json({ message: `Withdrew ${withdrawAmount} from ${targetNickname}. New balance: ${updatedUser.balance}` });
    } catch (error) {
        console.error("Withdraw error:", error);
        res.status(500).json({ message: 'Withdrawal failed' });
    }
});

app.post('/api/banker/balance', bankerAuth, async (req, res) => {
    const { targetNickname } = req.body;
    if (!targetNickname) return res.status(400).json({ message: 'Target nickname required' });

    try {
        const targetUser = await findUser(targetNickname);
        if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

        res.json({ nickname: targetUser.nickname, balance: targetUser.balance });
    } catch (error) {
        console.error("Get balance error:", error);
        res.status(500).json({ message: 'Failed to get balance' });
    }
});

// --- Функции админа ---
// Middleware для проверки, является ли запрашивающий админом
async function adminAuth(req, res, next) {
    const { adminNickname } = req.body; // Предполагаем, что админ передает свой ник
    if (!adminNickname) return res.status(401).json({ message: 'Admin nickname required' });
    
    const admin = await findUser(adminNickname);
    if (!admin || !admin.isAdmin) {
        return res.status(403).json({ message: 'Access denied: Not an admin or admin not found' });
    }
    req.admin = admin;
    next();
}

app.post('/api/admin/add-banker', adminAuth, async (req, res) => {
    const { targetNickname } = req.body;
    if (!targetNickname) return res.status(400).json({ message: 'Target nickname required' });

    try {
        const targetUser = await findUser(targetNickname);
        if (!targetUser) return res.status(404).json({ message: 'User to make banker not found' });

        if (targetUser.isBanker) {
            return res.status(400).json({ message: `${targetNickname} is already a banker.` });
        }

        await prisma.user.update({
            where: { nickname: targetNickname },
            data: { isBanker: true },
        });
        res.json({ message: `${targetNickname} is now a banker.` });
    } catch (error) {
        console.error("Add banker error:", error);
        res.status(500).json({ message: 'Failed to add banker' });
    }
});

app.post('/api/admin/remove-banker', adminAuth, async (req, res) => {
    const { targetNickname } = req.body;
    if (!targetNickname) return res.status(400).json({ message: 'Target nickname required' });

    try {
        const targetUser = await findUser(targetNickname);
        if (!targetUser) return res.status(404).json({ message: 'User to remove banker role from not found' });

        if (!targetUser.isBanker) {
            return res.status(400).json({ message: `${targetNickname} is not a banker.` });
        }

        await prisma.user.update({
            where: { nickname: targetNickname },
            data: { isBanker: false },
        });
        res.json({ message: `Banker role removed from ${targetNickname}.` });
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