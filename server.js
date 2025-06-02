// server.js
const express = require('express');
const path = require('path');
const { PrismaClient, OperationBy, TransactionType } = require('@prisma/client');
const crypto = require('crypto');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
require('dotenv').config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

app.use(express.json()); // Для парсинга JSON тел запросов
app.use(express.static(path.join(__dirname, 'public'))); // Сервируем статику

app.use(session({
    secret: 'NZehHqz2KQywsVMnksisrC6KXfuw4xuBFOTFXbdSvxp0pBnOlCi5dilemppSX2YO',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // true в продакшене с HTTPS
        httpOnly: true,
        maxAge: SESSION_DURATION
    }
}));

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

async function findUserById(userId) {
    return prisma.user.findUnique({ where: { id: parseInt(userId) } });
}

async function createTransaction({ senderCardNumber, receiverCardNumber, amount, type, operationBy }) {
    return prisma.transaction.create({
        data: {
            senderCardNumber: senderCardNumber ? parseInt(senderCardNumber) : null,
            receiverCardNumber: receiverCardNumber ? parseInt(receiverCardNumber) : null,
            amount: parseInt(amount),
            type: type,
            operationBy: operationBy,
        }
    });
}

// --- Роуты ---

// Главная страница - отдает HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// "Логин" - просто проверяет/создает пользователя и возвращает его данные
app.post('/api/login', async (req, res) => {
    const { nickname, password } = req.body;

    if (!nickname || !password) {
        return res.status(400).json({ message: 'Введите никнейм и пароль' });
    }

    try {
        const user = await prisma.user.findUnique({ where: { nickname } });

        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден!' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ message: 'Введены неверные данные!' });
        }

        req.session.userId = user.id;
        return res.json({ message: 'Login successful', user });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: 'Ошибка сервера при входе в систему' });
    }
});

app.post('/api/register', async (req, res) => {
    const { nickname, password } = req.body;

    if (!nickname || !password) {
        return res.status(400).json({ message: 'Введите никнейм и пароль' });
    }

    try {
        const existingUser = await prisma.user.findUnique({ where: { nickname } });

        if (existingUser) {
            return res.status(400).json({ message: 'Данное имя пользователя уже занято!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newCardNumber = await generateUniqueCardNumber();

        const user = await prisma.user.create({
            data: { cardNumber: newCardNumber, nickname, password: hashedPassword }
        });

        req.session.userId = user.id;
        return res.status(201).json({ message: 'Регистрация завершена успешно!', user });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: 'Ошибка сервера при регистрации' });
    }
});

async function userAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Неавторизованный пользователь!' });
    next();
}

app.get('/api/profile', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Сеанс истек' });
  }
  const user = await findUserById(req.session.userId);
  if (!user) {
        return res.status(404).json({ error: 'Игрок не найден!' });
    }
  return res.json({ message: 'Profile accessed', user: user });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).json({ message: 'Failed to log out' });
        }
        res.clearCookie('connect.sid'); // Очистка cookie сессии
        res.json({ message: 'Logged out successfully' });
    });
});

// --- Функции игрока ---
app.post('/api/player/transfer', userAuth, async (req, res) => {
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

        if (!sender) return res.status(404).json({ message: 'Отправитель не найден' });
        if (!receiver) return res.status(404).json({ message: 'Получатель не найден' });

        if (sender.balance < transferAmount) {
            return res.status(400).json({ message: 'Недостаточно средств!' });
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

        // Создаем транзакцию для перевода
        await createTransaction({
            senderCardNumber: senderCardNumber,
            receiverCardNumber: receiverCardNumber,
            amount: transferAmount,
            type: TransactionType.TRANSFER,
            operationBy: OperationBy.PLAYER
        });

        res.json({ message: `Transferred ${transferAmount} to ${receiverCardNumber}`, senderBalance: updatedSender.balance });
    } catch (error) {
        console.error("Transfer error:", error);
        res.status(500).json({ message: 'Во время транзакции произошла ошибка!' });
    }
});

app.get('/api/transaction-list', userAuth, bankerAuth, async (req, res) => {
    let transactions = await prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
        include: {
            sender: { select: { nickname: true, cardNumber: true } },
            receiver: { select: { nickname: true, cardNumber: true } }
        }
    });
    console.log("Transactions fetched:", transactions);
    return res.json(transactions);
});

app.get('/api/player/transactions', userAuth, async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await findUserById(req.session.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    try {
        const transactions = await prisma.transaction.findMany({
            where: {
                OR: [
                    { senderCardNumber: user.cardNumber },
                    { receiverCardNumber: user.cardNumber }
                ]
            },
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { nickname: true, cardNumber: true } },
                receiver: { select: { nickname: true, cardNumber: true } }
            },
            skip: 0,
            take: 10,
        });
        console.log("User transactions fetched:", transactions);
        return res.json(transactions);
    } catch (error) {
        console.error("Get transactions error:", error);
        return res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// --- Функции банкира ---
// Middleware для проверки, является ли запрашивающий банкиром
async function bankerAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ message: 'Unauthorized' });

    const banker = await findUserById(req.session.userId);
    if (!banker || !banker.isBanker) {
        return res.status(403).json({ message: 'Банкир не найден' });
    }
    req.banker = banker; // Сохраняем банкира в запросе для дальнейшего использования
    next();
}

app.post('/api/banker/deposit', userAuth, bankerAuth, async (req, res) => {
    const { targetCardNumber, amount } = req.body;
    const depositAmount = parseInt(amount, 10);

    if (!targetCardNumber || !depositAmount || depositAmount <= 0) {
        return res.status(400).json({ message: 'Неверные данные о переводе' });
    }

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });

        const updatedUser = await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { balance: { increment: depositAmount } },
        });

        // Создаем транзакцию для депозита
        await createTransaction({
            receiverCardNumber: targetCardNumber,
            amount: depositAmount,
            type: TransactionType.DEPOSIT,
            operationBy: OperationBy.BANK
        });

        res.json({ message: `Deposited ${depositAmount} to ${targetCardNumber}. New balance: ${updatedUser.balance}` });
    } catch (error) {
        console.error("Deposit error:", error);
        res.status(500).json({ message: 'Во время перевода произошла ошибка!' });
    }
});

app.post('/api/banker/withdraw', userAuth, bankerAuth, async (req, res) => {
    const { targetCardNumber, amount } = req.body;
    const withdrawAmount = parseInt(amount, 10);

    if (!targetCardNumber || !withdrawAmount || withdrawAmount <= 0) {
        return res.status(400).json({ message: 'Неверные данные!' });
    }

    try {
        const targetUser = await prisma.user.findUnique({
            where: { cardNumber: parseInt(targetCardNumber) },
        });
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден!' });

        if (targetUser.balance < withdrawAmount) {
            return res.status(400).json({ message: 'Недостаточно средств' });
        }

        const updatedUser = await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { balance: { decrement: withdrawAmount } },
        });

        // Создаем транзакцию для снятия средств
        await createTransaction({
            senderCardNumber: targetCardNumber,
            amount: withdrawAmount,
            type: TransactionType.WITHDRAWAL,
            operationBy: OperationBy.BANK,

        });

        res.json({ message: `Withdrew ${withdrawAmount} from ${targetCardNumber}. New balance: ${updatedUser.balance}` });
    } catch (error) {
        console.error("Withdraw error:", error);
        res.status(500).json({ message: 'Вывод средств не удался' });
    }
});

app.post('/api/banker/balance', userAuth, bankerAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });

        res.json({ cardNumber: targetUser.cardNumber, balance: targetUser.balance });
    } catch (error) {
        console.error("Get balance error:", error);
        res.status(500).json({ message: 'Failed to get balance' });
    }
});

// --- Функции админа ---
// Middleware для проверки, является ли запрашивающий админом
async function adminAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ message: 'Неавторизованный пользователь' });

    const admin = await findUserById(req.session.userId);
    if (!admin || !admin.isAdmin) {
        return res.status(403).json({ message: 'Пользователь не является администратором' });
    }
    req.admin = admin;
    next();
}

app.post('/api/admin/add-banker', userAuth, adminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты игрока' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });

        if (targetUser.isBanker) {
            return res.status(400).json({ message: `${targetCardNumber} теперь банкир!.` });
        }

        await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { isBanker: true },
        });
        res.json({ message: `${targetCardNumber} теперь банкир!.` });
    } catch (error) {
        console.error("Add banker error:", error);
        res.status(500).json({ message: 'Произошла ошибка при добавлении банкира' });
    }
});

app.post('/api/admin/remove-banker', userAuth, adminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });

        if (!targetUser.isBanker) {
            return res.status(400).json({ message: `${targetCardNumber} не является банкиром.` });
        }

        await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { isBanker: false },
        });
        res.json({ message: `Роль банкира была забрана у {targetCardNumber}.` });
    } catch (error) {
        console.error("Remove banker error:", error);
        res.status(500).json({ message: 'Ошибка при удалении банкира' });
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