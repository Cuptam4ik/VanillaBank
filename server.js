// server.js
const express = require('express');
const path = require('path');
const { PrismaClient, OperationBy, TransactionType } = require('@prisma/client');
const crypto = require('crypto');
const cors = require('cors'); // Если вы будете делать запросы с другого домена в будущем
const session = require('express-session');
const bcrypt = require('bcrypt');
require('dotenv').config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'NZehHqz2KQywsVMnksisrC6KXfuw4xuBFOTFXbdSvxp0pBnOlCi5dilemppSX2YO', // Измените на свой секрет!
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true в продакшене с HTTPS
        httpOnly: true,
        maxAge: SESSION_DURATION
    }
}));

async function generateUniqueCardNumber() {
    let cardNumber;
    let isUnique = false;
    while (!isUnique) {
      cardNumber = Math.floor(10000 + Math.random() * 90000);
      const existingUser = await prisma.user.findUnique({ where: { cardNumber: cardNumber } });
      if (!existingUser) isUnique = true;
    }
    return cardNumber;
}

async function findUserByCardNumber(cardNumber) {
    if (!cardNumber) return null;
    return prisma.user.findUnique({ where: { cardNumber: parseInt(cardNumber) } });
}

async function findUserById(userId) {
    if (!userId) return null;
    return prisma.user.findUnique({ where: { id: parseInt(userId) } });
}

async function createTransaction({ senderCardNumber, receiverCardNumber, amount, type, operationBy, finePaymentForId }) {
    return prisma.transaction.create({
        data: {
            senderCardNumber: senderCardNumber ? parseInt(senderCardNumber) : null,
            receiverCardNumber: receiverCardNumber ? parseInt(receiverCardNumber) : null,
            amount: parseInt(amount),
            type: type,
            operationBy: operationBy,
            finePaymentForId: finePaymentForId ? parseInt(finePaymentForId) : null
        }
    });
}

// --- Auth and Basic Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/login', async (req, res) => {
    const { nickname, password } = req.body;
    if (!nickname || !password) return res.status(400).json({ message: 'Введите никнейм и пароль' });
    try {
        const user = await prisma.user.findUnique({ where: { nickname } });
        if (!user) return res.status(404).json({ message: 'Пользователь не найден!' });
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) return res.status(401).json({ message: 'Введены неверные данные!' });
        
        const unpaidFinesCount = await prisma.fine.count({
            where: { userId: user.id, isPaid: false }
        });

        req.session.userId = user.id;
        res.json({ message: 'Login successful', user: { ...user, unpaidFinesCount } });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: 'Ошибка сервера при входе' });
    }
});

app.post('/api/register', async (req, res) => {
    const { nickname, password } = req.body;
    if (!nickname || !password) return res.status(400).json({ message: 'Введите никнейм и пароль' });
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
        res.status(201).json({ message: 'Регистрация завершена успешно!', user: { ...user, unpaidFinesCount: 0 } });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: 'Ошибка сервера при регистрации' });
    }
});

async function userAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Неавторизованный пользователь!' });
    const user = await findUserById(req.session.userId);
    if (!user) {
        // Если пользователя нет, возможно сессия устарела или невалидна
        req.session.destroy(); // Уничтожаем невалидную сессию
        return res.status(401).json({ error: 'Сессия недействительна, пожалуйста, войдите снова.' });
    }
    req.user = user;
    next();
}

app.get('/api/profile', userAuth, async (req, res) => {
    // req.user уже содержит актуальные данные пользователя из userAuth
    const unpaidFinesCount = await prisma.fine.count({
        where: { userId: req.user.id, isPaid: false }
    });
    // Возвращаем данные пользователя из сессии + свежее количество штрафов
    res.json({ message: 'Profile accessed', user: { ...req.user, unpaidFinesCount } });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).json({ message: 'Failed to log out' });
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out successfully' });
    });
});

// --- Player Routes ---
app.post('/api/player/transfer', userAuth, async (req, res) => {
    const { senderCardNumber, receiverCardNumber, amount } = req.body;
    const transferAmount = parseInt(amount, 10);

    if (!senderCardNumber || !receiverCardNumber || !transferAmount || transferAmount <= 0) {
        return res.status(400).json({ message: 'Неверные данные для перевода' });
    }
    if (parseInt(senderCardNumber) === parseInt(receiverCardNumber)) {
        return res.status(400).json({ message: 'Нельзя перевести средства самому себе' });
    }
    if (req.user.cardNumber !== parseInt(senderCardNumber)) {
        return res.status(403).json({ message: 'Вы можете переводить средства только со своей карты.' });
    }

    try {
        const sender = await findUserByCardNumber(senderCardNumber); // req.user could be used if senderCardNumber is confirmed to be req.user.cardNumber
        const receiver = await findUserByCardNumber(receiverCardNumber);

        if (!sender) return res.status(404).json({ message: 'Отправитель не найден' });
        if (!receiver) return res.status(404).json({ message: 'Получатель не найден' });

        if (sender.balance < transferAmount) {
            return res.status(400).json({ message: 'Недостаточно средств!' });
        }

        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { cardNumber: parseInt(senderCardNumber) },
                data: { balance: { decrement: transferAmount } },
            });
            await tx.user.update({
                where: { cardNumber: parseInt(receiverCardNumber) },
                data: { balance: { increment: transferAmount } },
            });
            await tx.transaction.create({
                 data: {
                    senderCardNumber: parseInt(senderCardNumber),
                    receiverCardNumber: parseInt(receiverCardNumber),
                    amount: transferAmount,
                    type: TransactionType.TRANSFER,
                    operationBy: OperationBy.PLAYER
                }
            });
        });
        
        const updatedSender = await findUserByCardNumber(senderCardNumber);
        res.json({ message: `Переведено ${transferAmount} на карту ${receiver.nickname} (${receiverCardNumber})`, senderBalance: updatedSender.balance });
    } catch (error) {
        console.error("Transfer error:", error);
        res.status(500).json({ message: 'Во время транзакции произошла ошибка!' });
    }
});

app.get('/api/player/my-fines', userAuth, async (req, res) => {
    try {
        const fines = await prisma.fine.findMany({
            where: {
                userId: req.user.id,
                isPaid: false, // Только неоплаченные
            },
            orderBy: { dueDate: 'asc' },
            include: {
                inspector: { select: { nickname: true, cardNumber: true } }
            }
        });
        res.json(fines);
    } catch (error) {
        console.error("Error fetching player fines:", error);
        res.status(500).json({ message: "Ошибка при загрузке штрафов" });
    }
});

app.post('/api/player/pay-fine/:fineId', userAuth, async (req, res) => {
    const { fineId } = req.params;
    if (!fineId || isNaN(parseInt(fineId))) return res.status(400).json({ message: "ID штрафа не указан или некорректен" });

    try {
        const fineToPay = await prisma.fine.findUnique({ where: { id: parseInt(fineId) } });

        if (!fineToPay) return res.status(404).json({ message: "Штраф не найден" });
        if (fineToPay.userId !== req.user.id) return res.status(403).json({ message: "Этот штраф выписан не вам" });
        if (fineToPay.isPaid) return res.status(400).json({ message: "Этот штраф уже оплачен" });
        
        const currentUserData = await findUserById(req.user.id); // Получаем актуальный баланс
        if (currentUserData.balance < fineToPay.amount) return res.status(400).json({ message: "Недостаточно средств для оплаты штрафа" });

        const [updatedUserResult, paidFineResult, transactionResult] = await prisma.$transaction([
            prisma.user.update({
                where: { id: req.user.id },
                data: { balance: { decrement: fineToPay.amount } },
            }),
            prisma.fine.update({
                where: { id: parseInt(fineId) },
                data: { isPaid: true, paidAt: new Date() },
            }),
            prisma.transaction.create({
                data: {
                    senderCardNumber: req.user.cardNumber,
                    receiverCardNumber: 10000, // Или ID "казны", если есть
                    amount: fineToPay.amount,
                    type: TransactionType.FINE,
                    operationBy: OperationBy.PLAYER,
                    finePaymentForId: parseInt(fineId)
                }
            })
        ]);
        
        const unpaidFinesCount = await prisma.fine.count({ where: { userId: req.user.id, isPaid: false }});

        res.json({ 
            message: `Штраф на сумму ${fineToPay.amount} успешно оплачен.`, 
            fine: paidFineResult, 
            newBalance: updatedUserResult.balance,
            unpaidFinesCount 
        });

    } catch (error) {
        console.error("Error paying fine:", error);
        res.status(500).json({ message: "Ошибка при оплате штрафа" });
    }
});

app.get('/api/player/transactions', userAuth, async (req, res) => {
    const user = req.user;
    try {
        const transactions = await prisma.transaction.findMany({
            where: { OR: [{ senderCardNumber: user.cardNumber }, { receiverCardNumber: user.cardNumber }] },
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { nickname: true, cardNumber: true } },
                receiver: { select: { nickname: true, cardNumber: true } }
            },
            take: 10,
        });
        res.json(transactions);
    } catch (error) {
        console.error("Get player transactions error:", error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// --- Role Auth Middlewares ---
async function bankerAuth(req, res, next) {
    if (!req.user || !req.user.isBanker) return res.status(403).json({ message: 'Пользователь не является банкиром' });
    req.banker = req.user; // Можно использовать req.user напрямую
    next();
}
async function adminAuth(req, res, next) {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ message: 'Пользователь не является администратором' });
    req.admin = req.user; // Можно использовать req.user напрямую
    next();
}
async function inspectorAuth(req, res, next) {
    if (!req.user || !req.user.isInspector) return res.status(403).json({ message: 'Пользователь не является инспектором' });
    req.inspector = req.user; // Можно использовать req.user напрямую
    next();
}
async function bankerOrAdminAuth(req, res, next) {
    if (!req.user || (!req.user.isBanker && !req.user.isAdmin)) {
        return res.status(403).json({ message: 'Доступ запрещен: требуется роль банкира или администратора' });
    }
    next();
}

// --- Banker Routes ---
app.post('/api/banker/deposit', userAuth, bankerAuth, async (req, res) => {
    const { targetCardNumber, amount } = req.body;
    const depositAmount = parseInt(amount, 10);
    if (!targetCardNumber || !depositAmount || depositAmount <= 0) return res.status(400).json({ message: 'Неверные данные' });
    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });
        const updatedUser = await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { balance: { increment: depositAmount } },
        });
        await createTransaction({
            receiverCardNumber: targetCardNumber,
            amount: depositAmount,
            type: TransactionType.DEPOSIT,
            operationBy: OperationBy.BANK
        });
        res.json({ message: `Пополнено ${depositAmount} на карту ${targetUser.nickname} (${targetCardNumber}). Новый баланс: ${updatedUser.balance}` });
    } catch (e) { console.error("Deposit error:",e); res.status(500).json({message: 'Ошибка сервера при пополнении'})}
});

app.post('/api/banker/withdraw', userAuth, bankerAuth, async (req, res) => {
    const { targetCardNumber, amount } = req.body;
    const withdrawAmount = parseInt(amount, 10);
     if (!targetCardNumber || !withdrawAmount || withdrawAmount <= 0) return res.status(400).json({ message: 'Неверные данные' });
    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });
        
        const updatedUser = await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { balance: { decrement: withdrawAmount } },
        });
         await createTransaction({
            senderCardNumber: targetCardNumber,
            amount: withdrawAmount,
            type: TransactionType.WITHDRAWAL,
            operationBy: OperationBy.BANK
        });
        res.json({ message: `Списано ${withdrawAmount} с карты ${targetUser.nickname} (${targetCardNumber}). Новый баланс: ${updatedUser.balance}` });
    } catch (e) { console.error("Withdraw error:", e); res.status(500).json({message: 'Ошибка сервера при списании'})}
});

app.post('/api/banker/balance', userAuth, bankerAuth, async (req, res) => { 
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });
    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });
        res.json({ cardNumber: targetUser.cardNumber, balance: targetUser.balance, nickname: targetUser.nickname });
    } catch (e) { console.error("Get balance error:", e); res.status(500).json({message: 'Ошибка сервера при получении баланса'})}
});

// --- Admin Routes ---
app.post('/api/admin/add-banker', userAuth, adminAuth, async (req, res) => { 
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });
    try {
        const user = await findUserByCardNumber(targetCardNumber);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        if (user.isBanker) return res.status(400).json({ message: `${user.nickname} (${user.cardNumber}) уже банкир` });
        await prisma.user.update({ where: { cardNumber: parseInt(targetCardNumber) }, data: { isBanker: true } });
        res.json({ message: `${user.nickname} (${user.cardNumber}) теперь банкир` });
    } catch (e) { console.error("Add banker error:", e); res.status(500).json({message: 'Ошибка сервера'})}
});

app.post('/api/admin/remove-banker', userAuth, adminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });
    try {
        const user = await findUserByCardNumber(targetCardNumber);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        if (!user.isBanker) return res.status(400).json({ message: `${user.nickname} (${user.cardNumber}) не является банкиром` });
        await prisma.user.update({ where: { cardNumber: parseInt(targetCardNumber) }, data: { isBanker: false } });
        res.json({ message: `Роль банкира снята с ${user.nickname} (${user.cardNumber})` });
    } catch (e) { console.error("Remove banker error:", e); res.status(500).json({message: 'Ошибка сервера'})}
});

app.post('/api/admin/add-inspector', userAuth, adminAuth, async (req, res) => { 
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });
    try {
        const user = await findUserByCardNumber(targetCardNumber);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        if (user.isInspector) return res.status(400).json({ message: `${user.nickname} (${user.cardNumber}) уже инспектор` });
        await prisma.user.update({ where: { cardNumber: parseInt(targetCardNumber) }, data: { isInspector: true } });
        res.json({ message: `${user.nickname} (${user.cardNumber}) теперь инспектор` });
    } catch (e) { console.error("Add inspector error:", e); res.status(500).json({message: 'Ошибка сервера'})}
});

app.post('/api/admin/remove-inspector', userAuth, adminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });
    try {
        const user = await findUserByCardNumber(targetCardNumber);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        if (!user.isInspector) return res.status(400).json({ message: `${user.nickname} (${user.cardNumber}) не является инспектором` });
        await prisma.user.update({ where: { cardNumber: parseInt(targetCardNumber) }, data: { isInspector: false } });
        res.json({ message: `Роль инспектора снята с ${user.nickname} (${user.cardNumber})` });
    } catch (e) { console.error("Remove inspector error:", e); res.status(500).json({message: 'Ошибка сервера'})}
});

// --- Inspector Routes ---
app.post('/api/inspector/issue-fine', userAuth, inspectorAuth, async (req, res) => {
    const { targetCardNumber, amount, reason, daysUntilDue } = req.body;
    const fineAmount = parseInt(amount, 10);
    const numDays = parseInt(daysUntilDue, 10);

    if (!targetCardNumber || !fineAmount || fineAmount <= 0 || !numDays || numDays <= 0) {
        return res.status(400).json({ message: 'Неверные данные для штрафа! Укажите карту, сумму и срок (в днях > 0).' });
    }

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь для штрафа не найден!' });
        if (targetUser.id === req.inspector.id) return res.status(400).json({ message: 'Нельзя выписать штраф самому себе.' });

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + numDays);
        dueDate.setHours(23, 59, 59, 999); // Конец дня указанной даты

        const newFine = await prisma.fine.create({
            data: {
                userId: targetUser.id,
                issuedByInspectorId: req.inspector.id, // req.user.id if inspector is req.user
                amount: fineAmount,
                reason: reason || null,
                dueDate: dueDate,
            }
        });

        res.json({ 
            message: `Штраф на сумму ${fineAmount} для ${targetUser.nickname} (${targetCardNumber}) успешно выписан. Срок оплаты: ${dueDate.toLocaleDateString('ru-RU')}.`, 
            fine: newFine 
        });
    } catch (error) {
        console.error("Issue fine error:", error);
        res.status(500).json({ message: 'Ошибка при выписке штрафа' });
    }
});

app.get('/api/inspector/my-overdue-fines', userAuth, inspectorAuth, async (req, res) => {
    try {
        const overdueFines = await prisma.fine.findMany({
            where: {
                issuedByInspectorId: req.inspector.id, // req.user.id if inspector is req.user
                isPaid: false,
                dueDate: { lt: new Date() } 
            },
            include: {
                user: { select: { nickname: true, cardNumber: true } } 
            },
            orderBy: { dueDate: 'asc' }
        });
        // Здесь можно добавить логику для отправки уведомлений инспектору, если это необходимо в будущем.
        // Для простого отображения на фронте, этого достаточно.
        res.json(overdueFines);
    } catch (error) {
        console.error("Error fetching overdue fines for inspector:", error);
        res.status(500).json({ message: "Ошибка при загрузке просроченных штрафов" });
    }
});

// --- Global Transaction List (for Banker/Admin) ---
app.get('/api/transaction-list', userAuth, bankerOrAdminAuth, async (req, res) => {
    try {
        const transactions = await prisma.transaction.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20, 
            include: {
                sender: { select: { nickname: true, cardNumber: true } },
                receiver: { select: { nickname: true, cardNumber: true } }
            }
        });
        res.json(transactions);
    } catch (error) {
        console.error("Error fetching all transactions:", error);
        res.status(500).json({ message: "Ошибка при загрузке списка транзакций" });
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