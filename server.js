// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { PrismaClient, OperationBy, TransactionType } = require('@prisma/client');
const session = require('express-session');
const { spawn } = require('child_process');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Переменные конфигурации заданы напрямую ---
const PORT = 3000;
const BOT_API_URL = 'http://localhost:5001';
const BOT_API_SECRET = 'sk-AppXYZ-AuthToken-QWERTY12345';
const NODE_ENV_IS_PRODUCTION = false; // Ставим false для теста
// ------------------------------------------------

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const CALL_COOLDOWN_DURATION = 5 * 60 * 1000;
const TREASURY_CARD_NUMBER = 10000;

const callCooldowns = new Map();
let pythonBotProcess = null;
const userSockets = new Map();

// --- Express Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessionMiddleware = session({
    secret: 'NZehHqz2KQywsVMnksisrC6KXfuw4xuBFOTFXbdSvxp0pBnOlCi5dilemppSX2YO',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: NODE_ENV_IS_PRODUCTION, // Используем переменную
        httpOnly: true,
        maxAge: SESSION_DURATION
    }
});
app.use(sessionMiddleware);

// --- Socket.IO Integration ---
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (session && session.userId) {
        console.log(`Socket.IO Client connected: ${socket.id}, User ID: ${session.userId}`);
        userSockets.set(session.userId, socket.id);

        socket.on('disconnect', () => {
            console.log(`Socket.IO Client disconnected: ${socket.id}`);
            if (userSockets.get(session.userId) === socket.id) {
                userSockets.delete(session.userId);
            }
        });
    } else {
        console.log(`Socket.IO Client connected: ${socket.id}, but not authenticated.`);
    }
});

function emitToUser(userId, event, data) {
    const socketId = userSockets.get(userId);
    if (socketId) {
        io.to(socketId).emit(event, data);
        console.log(`Emitted event '${event}' to user ${userId} via socket ${socketId}`);
    }
}

// --- Utility Functions ---
async function generateUniqueCardNumber() {
    let cardNumber;
    let isUnique = false;
    while (!isUnique) {
      cardNumber = Math.floor(10000 + Math.random() * 90000);
      if (cardNumber === TREASURY_CARD_NUMBER) continue;
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

async function createTransaction({ tx, senderCardNumber, receiverCardNumber, amount, type, operationBy, finePaymentForId, reason }) {
    const prismaClient = tx || prisma;
    return prismaClient.transaction.create({
        data: {
            senderCardNumber: senderCardNumber ? parseInt(senderCardNumber) : null,
            receiverCardNumber: receiverCardNumber ? parseInt(receiverCardNumber) : null,
            amount: parseInt(amount),
            type: type,
            operationBy: operationBy,
            finePaymentForId: finePaymentForId ? parseInt(finePaymentForId) : null,
            reason: reason || null
        }
    });
}

async function createAdminLog(adminId, action, targetUserNickname, details) {
    try {
        await prisma.adminLog.create({
            data: { adminId, action, targetUserNickname, details }
        });
    } catch (error) {
        console.error("Failed to create admin log:", error);
    }
}


// --- API Routes ---

// --- Auth and Basic Routes ---
app.post('/api/login', async (req, res) => {
    const { nickname, password } = req.body;
    if (!nickname || !password) return res.status(400).json({ message: 'Введите никнейм и пароль' });
    try {
        const user = await prisma.user.findUnique({ where: { nickname } });
        if (!user) return res.status(404).json({ message: 'Пользователь не найден!' });
        
        // Убрано сравнение хеша, теперь простое сравнение строк
        const passwordMatch = (password === user.password);
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
        // Убрано хеширование, пароль сохраняется в открытом виде (НЕБЕЗОПАСНО!)
        const newCardNumber = await generateUniqueCardNumber();
        const user = await prisma.user.create({
            data: { cardNumber: newCardNumber, nickname, password: password }
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
        req.session.destroy();
        return res.status(401).json({ error: 'Сессия недействительна, пожалуйста, войдите снова.' });
    }
    req.user = user;
    next();
}

// --- ЕДИНЫЙ МАРШРУТ ДЛЯ ПОИСКА ПОЛЬЗОВАТЕЛЕЙ (С ОПТИМИЗАЦИЕЙ) ---
app.get('/api/users/search', userAuth, async (req, res) => {
    const { nickname, cardNumber } = req.query;

    if ((!nickname || nickname.length < 2) && (!cardNumber || cardNumber.length < 2)) {
        return res.json([]);
    }
    
    try {
        let whereClause = { id: { not: req.user.id } };
        let matchingUsers = [];

        if (nickname) {
            whereClause.nickname = {
                contains: nickname,
            };
            matchingUsers = await prisma.user.findMany({
                where: whereClause,
                take: 5,
                select: { nickname: true, cardNumber: true }
            });
        } else if (cardNumber) {
            // Эффективный поиск по номеру карты с использованием диапазона
            const query = String(cardNumber);
            const CARD_NUMBER_LENGTH = 5; // Длина номера карты (10000-99999)
            if (query.length > 0 && query.length <= CARD_NUMBER_LENGTH) {
                const power = CARD_NUMBER_LENGTH - query.length;
                const gte = parseInt(query) * (10 ** power);
                const lt = gte + (10 ** power); // Поиск до следующего "десятка", например 123 -> от 12300 до 12400 (не включая)
                
                whereClause.cardNumber = { gte, lt };
                
                matchingUsers = await prisma.user.findMany({
                    where: whereClause,
                    take: 5,
                    select: { nickname: true, cardNumber: true }
                });
            }
        }

        res.json(matchingUsers);

    } catch (error) {
        console.error("User search error:", error);
        res.status(500).json({ message: 'Ошибка при поиске пользователя' });
    }
});

app.get('/api/profile', userAuth, async (req, res) => {
    const unpaidFinesCount = await prisma.fine.count({
        where: { userId: req.user.id, isPaid: false }
    });
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


// --- Staff Call Endpoints ---
app.post('/api/call/banker', userAuth, async (req, res) => {
    const userId = req.user.id;
    const userNickname = req.user.nickname;
    const callerDiscordId = req.user.id.toString();

    const lastCallTime = callCooldowns.get(`banker_${userId}`);
    if (lastCallTime && (Date.now() - lastCallTime < CALL_COOLDOWN_DURATION)) {
        const timeLeft = Math.ceil((CALL_COOLDOWN_DURATION - (Date.now() - lastCallTime)) / 1000);
        return res.status(429).json({ message: `Вызов банкира на перезарядке. Пожалуйста, подождите ${timeLeft} секунд.` });
    }

    try {
        const botResponse = await fetch(BOT_API_URL + '/call-banker-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret': BOT_API_SECRET },
            body: JSON.stringify({ user_nickname: userNickname, caller_id: callerDiscordId })
        });
        const responseData = await botResponse.json().catch(() => null);
        if (!botResponse.ok) {
            console.error(`Bot API error for /call-banker: ${botResponse.status}`, responseData);
            return res.status(botResponse.status).json({ message: responseData?.message || 'Ошибка при вызове банкира через бота.' });
        }
        callCooldowns.set(`banker_${userId}`, Date.now());
        res.json({ message: responseData?.message || 'Запрос банкиру отправлен. Ожидайте ответа в Discord.' });
    } catch (error) {
        console.error("Error calling banker via bot:", error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера при вызове банкира.' });
    }
});

app.post('/api/call/inspector', userAuth, async (req, res) => {
    const userId = req.user.id;
    const userNickname = req.user.nickname;
    const callerDiscordId = req.user.id.toString();

    const lastCallTime = callCooldowns.get(`inspector_${userId}`);
    if (lastCallTime && (Date.now() - lastCallTime < CALL_COOLDOWN_DURATION)) {
        const timeLeft = Math.ceil((CALL_COOLDOWN_DURATION - (Date.now() - lastCallTime)) / 1000);
        return res.status(429).json({ message: `Вызов инспектора на перезарядке. Пожалуйста, подождите ${timeLeft} секунд.` });
    }

    try {
        const botResponse = await fetch(BOT_API_URL + '/call-inspector-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret': BOT_API_SECRET },
            body: JSON.stringify({ user_nickname: userNickname, caller_id: callerDiscordId })
        });
        const responseData = await botResponse.json().catch(() => null);
        if (!botResponse.ok) {
            console.error(`Bot API error for /call-inspector: ${botResponse.status}`, responseData);
            return res.status(botResponse.status).json({ message: responseData?.message || 'Ошибка при вызове инспектора через бота.' });
        }
        callCooldowns.set(`inspector_${userId}`, Date.now());
        res.json({ message: responseData?.message || 'Запрос инспектору отправлен. Ожидайте ответа в Discord.' });
    } catch (error) {
        console.error("Error calling inspector via bot:", error);
        res.status(500).json({ message: 'Внутренняя ошибка сервера при вызове инспектора.' });
    }
});

// --- Player Routes ---
async function checkFrozenAccount(req, res, next) {
    if (req.user && req.user.isFrozen) {
        return res.status(403).json({ message: 'Действие невозможно: ваш счет заморожен!' });
    }
    next();
}

app.post('/api/player/transfer', userAuth, checkFrozenAccount, async (req, res) => {
    const { senderCardNumber, receiverCardNumber, amount, reason } = req.body;
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
        const sender = await findUserByCardNumber(senderCardNumber);
        const receiver = await findUserByCardNumber(receiverCardNumber);

        if (!sender) return res.status(404).json({ message: 'Отправитель не найден' });
        if (!receiver) return res.status(404).json({ message: 'Получатель не найден' });
        
        if (receiver.isFrozen) {
            return res.status(403).json({ message: `Перевод невозможен: счет получателя ${receiver.nickname} заморожен.` });
        }
        if (sender.balance < transferAmount) {
            return res.status(400).json({ message: 'Недостаточно средств!' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const updatedSender = await tx.user.update({
                where: { cardNumber: parseInt(senderCardNumber) },
                data: { balance: { decrement: transferAmount } },
            });
            const updatedReceiver = await tx.user.update({
                where: { cardNumber: parseInt(receiverCardNumber) },
                data: { balance: { increment: transferAmount } },
            });
            await createTransaction({
                tx, senderCardNumber, receiverCardNumber, amount: transferAmount,
                type: TransactionType.TRANSFER, operationBy: OperationBy.PLAYER, reason,
            });
            
            emitToUser(updatedReceiver.id, 'update', { type: 'balance', newBalance: updatedReceiver.balance });
            emitToUser(updatedReceiver.id, 'notification', { type: 'success', message: `Вы получили перевод ${transferAmount} аб от ${sender.nickname}` });

            return updatedSender;
        });
        
        res.json({ message: `Переведено ${transferAmount} аб на карту ${receiver.nickname} (${receiverCardNumber})`, senderBalance: result.balance });

    } catch (error) {
        console.error("Transfer error:", error);
        res.status(500).json({ message: 'Во время транзакции произошла ошибка!' });
    }
});

app.get('/api/player/my-fines', userAuth, async (req, res) => {
    try {
        const fines = await prisma.fine.findMany({
            where: { userId: req.user.id, isPaid: false },
            orderBy: { dueDate: 'asc' },
            include: { inspector: { select: { nickname: true, cardNumber: true } } }
        });
        res.json(fines);
    } catch (error) {
        console.error("Error fetching player fines:", error);
        res.status(500).json({ message: "Ошибка при загрузке штрафов" });
    }
});

app.post('/api/player/pay-fine/:fineId', userAuth, checkFrozenAccount, async (req, res) => {
    const { fineId } = req.params;
    if (!fineId || isNaN(parseInt(fineId))) return res.status(400).json({ message: "ID штрафа не указан или некорректен" });

    try {
        const fineToPay = await prisma.fine.findUnique({ where: { id: parseInt(fineId) } });

        if (!fineToPay) return res.status(404).json({ message: "Штраф не найден" });
        if (fineToPay.userId !== req.user.id) return res.status(403).json({ message: "Этот штраф выписан не вам" });
        if (fineToPay.isPaid) return res.status(400).json({ message: "Этот штраф уже оплачен" });
        if (req.user.balance < fineToPay.amount) return res.status(400).json({ message: "Недостаточно средств для оплаты штрафа" });

        const [updatedUserResult, paidFineResult] = await prisma.$transaction([
            prisma.user.update({
                where: { id: req.user.id },
                data: { balance: { decrement: fineToPay.amount } },
            }),
            prisma.fine.update({
                where: { id: parseInt(fineId) },
                data: { isPaid: true, paidAt: new Date() },
            }),
            createTransaction({
                 senderCardNumber: req.user.cardNumber,
                 receiverCardNumber: TREASURY_CARD_NUMBER,
                 amount: fineToPay.amount,
                 type: TransactionType.FINE,
                 operationBy: OperationBy.PLAYER,
                 finePaymentForId: parseInt(fineId),
                 reason: `Payment for fine #${fineId}`
            })
        ]);

        const unpaidFinesCount = await prisma.fine.count({ where: { userId: req.user.id, isPaid: false }});
        
        emitToUser(req.user.id, 'update', { type: 'fines', unpaidFinesCount: unpaidFinesCount });

        res.json({
            message: `Штраф на сумму ${fineToPay.amount} успешно оплачен.`,
            newBalance: updatedUserResult.balance,
            unpaidFinesCount
        });

    } catch (error) {
        console.error("Error paying fine:", error);
        res.status(500).json({ message: "Ошибка при оплате штрафа" });
    }
});

app.get('/api/player/transactions', userAuth, async (req, res) => {
    try {
        const transactions = await prisma.transaction.findMany({
            where: { OR: [{ senderCardNumber: req.user.cardNumber }, { receiverCardNumber: req.user.cardNumber }] },
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { nickname: true, cardNumber: true } },
                receiver: { select: { nickname: true, cardNumber: true } }
            },
            take: 20,
        });
        res.json(transactions);
    } catch (error) {
        console.error("Get player transactions error:", error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

app.get('/api/player/balance-history', userAuth, async(req, res) => {
    try {
        const transactions = await prisma.transaction.findMany({
            where: {
                OR: [
                    { senderCardNumber: req.user.cardNumber },
                    { receiverCardNumber: req.user.cardNumber }
                ]
            },
            orderBy: { createdAt: 'asc' },
            take: 50
        });

        const earliestTx = transactions.length > 0 ? transactions[0] : null;
        let startingBalance = req.user.balance;

        for(let i = transactions.length - 1; i >= 0; i--) {
            const tx = transactions[i];
             if (tx.receiverCardNumber === req.user.cardNumber) {
                startingBalance -= tx.amount;
            }
            if (tx.senderCardNumber === req.user.cardNumber) {
                startingBalance += tx.amount;
            }
        }

        const history = [{ date: earliestTx ? new Date(earliestTx.createdAt.getTime() - 1000) : new Date(), balance: startingBalance }];

        transactions.forEach(tx => {
            if (tx.receiverCardNumber === req.user.cardNumber) {
                startingBalance += tx.amount;
            }
            if (tx.senderCardNumber === req.user.cardNumber) {
                startingBalance -= tx.amount;
            }
            history.push({ date: tx.createdAt, balance: startingBalance });
        });
        
        res.json(history);
    } catch (error) {
        console.error("Balance history error:", error);
        res.status(500).json({ message: 'Ошибка получения истории баланса' });
    }
});


// --- Role Auth Middlewares ---
async function bankerAuth(req, res, next) {
    if (!req.user || !req.user.isBanker) return res.status(403).json({ message: 'Пользователь не является банкиром' });
    req.banker = req.user;
    next();
}
async function adminAuth(req, res, next) {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ message: 'Пользователь не является администратором' });
    req.admin = req.user;
    next();
}
async function inspectorAuth(req, res, next) {
    if (!req.user || !req.user.isInspector) return res.status(403).json({ message: 'Пользователь не является инспектором' });
    req.inspector = req.user;
    next();
}
async function bankerOrAdminAuth(req, res, next) {
    if (!req.user || (!req.user.isBanker && !req.user.isAdmin)) {
        return res.status(403).json({ message: 'Доступ запрещен: требуется роль банкира или администратора' });
    }
    next();
}
async function inspectorOrAdminAuth(req, res, next) {
    if (!req.user || (!req.user.isInspector && !req.user.isAdmin)) {
        return res.status(403).json({ message: 'Доступ запрещен: требуется роль инспектора или администратора' });
    }
    next();
}


// --- Banker Routes ---
app.post('/api/banker/deposit', userAuth, bankerOrAdminAuth, async (req, res) => {
    const { targetCardNumber, amount } = req.body;
    const depositAmount = parseInt(amount, 10);
    if (!targetCardNumber || !depositAmount || depositAmount <= 0) return res.status(400).json({ message: 'Неверные данные' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });
        if (targetUser.isFrozen) return res.status(403).json({ message: `Действие невозможно: счет пользователя ${targetUser.nickname} заморожен!` });

        const updatedUser = await prisma.$transaction(async (tx) => {
            const userAfterUpdate = await tx.user.update({
                where: { cardNumber: parseInt(targetCardNumber) },
                data: { balance: { increment: depositAmount } },
            });
            await createTransaction({
                tx, receiverCardNumber: targetCardNumber, amount: depositAmount,
                type: TransactionType.DEPOSIT, operationBy: OperationBy.BANK, reason: `Banker deposit by ${req.user.nickname}`
            });
            return userAfterUpdate;
        });

        emitToUser(updatedUser.id, 'update', { type: 'balance', newBalance: updatedUser.balance });
        emitToUser(updatedUser.id, 'notification', { type: 'success', message: `Ваш счет пополнен на ${depositAmount} аб банкиром ${req.user.nickname}` });

        res.json({ message: `Пополнено ${depositAmount} аб на карту ${targetUser.nickname} (${targetCardNumber}). Новый баланс: ${updatedUser.balance}` });
    } catch (e) { console.error("Deposit error:",e); res.status(500).json({message: 'Ошибка сервера при пополнении'})}
});

app.post('/api/banker/withdraw', userAuth, bankerOrAdminAuth, async (req, res) => {
    const { targetCardNumber, amount } = req.body;
    const withdrawAmount = parseInt(amount, 10);
     if (!targetCardNumber || !withdrawAmount || withdrawAmount <= 0) return res.status(400).json({ message: 'Неверные данные' });

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });
        if (targetUser.isFrozen) return res.status(403).json({ message: `Действие невозможно: счет пользователя ${targetUser.nickname} заморожен!` });
        if (targetUser.balance < withdrawAmount) return res.status(400).json({ message: 'У пользователя недостаточно средств для списания' });

        const updatedUser = await prisma.$transaction(async (tx) => {
            const userAfterUpdate = await tx.user.update({
                where: { cardNumber: parseInt(targetCardNumber) },
                data: { balance: { decrement: withdrawAmount } },
            });
            await createTransaction({
                tx, senderCardNumber: targetCardNumber, amount: withdrawAmount,
                type: TransactionType.WITHDRAWAL, operationBy: OperationBy.BANK, reason: `Banker withdrawal by ${req.user.nickname}`
            });
            return userAfterUpdate;
        });

        emitToUser(updatedUser.id, 'update', { type: 'balance', newBalance: updatedUser.balance });
        emitToUser(updatedUser.id, 'notification', { type: 'error', message: `С вашего счета списано ${withdrawAmount} аб банкиром ${req.user.nickname}` });

        res.json({ message: `Списано ${withdrawAmount} с карты ${targetUser.nickname} (${targetCardNumber}). Новый баланс: ${updatedUser.balance}` });
    } catch (e) { console.error("Withdraw error:", e); res.status(500).json({message: 'Ошибка сервера при списании'})}
});

app.post('/api/banker/balance', userAuth, bankerOrAdminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });
    try {
        const targetUser = await prisma.user.findUnique({
            where: { cardNumber: parseInt(targetCardNumber) }
        });
        if (!targetUser) return res.status(404).json({ message: 'Пользователь не найден' });

        const recentTransactions = await prisma.transaction.findMany({
            where: {
                OR: [
                    { senderCardNumber: targetUser.cardNumber },
                    { receiverCardNumber: targetUser.cardNumber }
                ]
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { sender: {select:{nickname:true, cardNumber: true}}, receiver: {select:{nickname:true, cardNumber: true}} }
        });

        const unpaidFines = await prisma.fine.findMany({
            where: { userId: targetUser.id, isPaid: false },
            include: { inspector: { select: { nickname: true } } }
        });

        res.json({
            user: targetUser,
            recentTransactions,
            unpaidFines
        });

    } catch (e) { console.error("Get balance error:", e); res.status(500).json({message: 'Ошибка сервера'})}
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
        await createAdminLog(req.user.id, 'GAVE_BANKER_ROLE', user.nickname, null);
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
        await createAdminLog(req.user.id, 'REMOVED_BANKER_ROLE', user.nickname, null);
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
        await createAdminLog(req.user.id, 'GAVE_INSPECTOR_ROLE', user.nickname, null);
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
        await createAdminLog(req.user.id, 'REMOVED_INSPECTOR_ROLE', user.nickname, null);
        res.json({ message: `Роль инспектора снята с ${user.nickname} (${user.cardNumber})` });
    } catch (e) { console.error("Remove inspector error:", e); res.status(500).json({message: 'Ошибка сервера'})}
});

app.post('/api/admin/toggle-freeze', userAuth, adminAuth, async (req, res) => {
    const { targetCardNumber } = req.body;
    if (!targetCardNumber) return res.status(400).json({ message: 'Требуется номер карты' });
    try {
        const user = await findUserByCardNumber(targetCardNumber);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        if (user.isAdmin) return res.status(403).json({ message: 'Нельзя заморозить счет администратора' });

        const updatedUser = await prisma.user.update({
            where: { cardNumber: parseInt(targetCardNumber) },
            data: { isFrozen: !user.isFrozen }
        });

        const action = updatedUser.isFrozen ? 'FROZE_ACCOUNT' : 'UNFROZE_ACCOUNT';
        const message = updatedUser.isFrozen ? 'заморожен' : 'разморожен';
        await createAdminLog(req.user.id, action, user.nickname, `Action by ${req.user.nickname}`);

        emitToUser(user.id, 'notification', { type: updatedUser.isFrozen ? 'error' : 'success', message: `Ваш счет был ${message} сотрудником ${req.user.nickname}` });
        emitToUser(user.id, 'update', { type: 'frozen_status', isFrozen: updatedUser.isFrozen });

        res.json({ message: `Счет пользователя ${user.nickname} был ${message}`, isFrozen: updatedUser.isFrozen, user: updatedUser });

    } catch (e) { console.error("Freeze toggle error:", e); res.status(500).json({message: 'Ошибка сервера'})}
});

app.get('/api/admin/stats', userAuth, adminAuth, async (req, res) => {
    try {
        const totalUsers = await prisma.user.count();
        const totalMoney = await prisma.user.aggregate({ _sum: { balance: true } });
        const sevenDaysAgo = new Date(new Date().setDate(new Date().getDate() - 7));
        const transactionsLast7Days = await prisma.transaction.count({
            where: { createdAt: { gte: sevenDaysAgo } }
        });
        
        const days = Array.from({length: 7}, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return d.toISOString().split('T')[0];
        }).reverse();

        const dailyCounts = await Promise.all(days.map(async (day) => {
            const start = new Date(day);
            const end = new Date(day);
            end.setDate(end.getDate() + 1);
            const count = await prisma.transaction.count({
                where: {
                    createdAt: {
                        gte: start,
                        lt: end
                    }
                }
            });
            return { day, count };
        }));

        res.json({
            totalUsers,
            totalMoney: totalMoney._sum.balance || 0,
            transactionsLast7Days,
            chartData: {
                labels: dailyCounts.map(item => new Date(item.day).toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit'})),
                data: dailyCounts.map(item => item.count)
            }
        });
    } catch (error) {
        console.error("Admin stats error:", error);
        res.status(500).json({ message: "Ошибка загрузки статистики" });
    }
});

app.get('/api/admin/users', userAuth, adminAuth, async (req, res) => {
    const { search } = req.query;
    try {
        const users = await prisma.user.findMany({
            where: {
                nickname: {
                    contains: search || '',
                    // mode: 'insensitive' // Not supported by SQLite
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(users);
    } catch (error) {
        console.error("Admin get users error:", error);
        res.status(500).json({ message: "Ошибка загрузки пользователей" });
    }
});

app.get('/api/admin/logs', userAuth, adminAuth, async (req, res) => {
    try {
        const logs = await prisma.adminLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { admin: { select: { nickname: true } } }
        });
        res.json(logs);
    } catch (error) {
        console.error("Admin get logs error:", error);
        res.status(500).json({ message: "Ошибка загрузки логов" });
    }
});


// --- Inspector Routes ---
app.post('/api/inspector/issue-fine', userAuth, inspectorOrAdminAuth, async (req, res) => {
    const { targetCardNumber, amount, reason, daysUntilDue } = req.body;
    const fineAmount = parseInt(amount, 10);
    const numDays = parseInt(daysUntilDue, 10);

    if (!targetCardNumber || !fineAmount || fineAmount <= 0 || !numDays || numDays <= 0) {
        return res.status(400).json({ message: 'Неверные данные для штрафа! Укажите карту, сумму и срок (в днях > 0).' });
    }

    try {
        const targetUser = await findUserByCardNumber(targetCardNumber);
        if (!targetUser) return res.status(404).json({ message: 'Пользователь для штрафа не найден!' });
        if (targetUser.id === req.user.id) return res.status(400).json({ message: 'Нельзя выписать штраф самому себе.' });

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + numDays);
        dueDate.setHours(23, 59, 59, 999);

        const newFine = await prisma.fine.create({
            data: {
                userId: targetUser.id,
                issuedByInspectorId: req.user.id,
                amount: fineAmount,
                reason: reason || null,
                dueDate: dueDate,
            }
        });

        emitToUser(targetUser.id, 'notification', { type: 'error', message: `Вам выписан штраф на ${fineAmount} аб от ${req.user.nickname}` });
        const unpaidFinesCount = await prisma.fine.count({ where: { userId: targetUser.id, isPaid: false }});
        emitToUser(targetUser.id, 'update', { type: 'fines', unpaidFinesCount: unpaidFinesCount });

        res.json({
            message: `Штраф на сумму ${fineAmount} для ${targetUser.nickname} (${targetCardNumber}) успешно выписан.`,
            fine: newFine
        });
    } catch (error) {
        console.error("Issue fine error:", error);
        res.status(500).json({ message: 'Ошибка при выписке штрафа' });
    }
});

app.get('/api/inspector/my-overdue-fines', userAuth, inspectorOrAdminAuth, async (req, res) => {
    try {
        const overdueFines = await prisma.fine.findMany({
            where: {
                issuedByInspectorId: req.user.id,
                isPaid: false,
                dueDate: { lt: new Date() }
            },
            include: { user: { select: { nickname: true, cardNumber: true } } },
            orderBy: { dueDate: 'asc' }
        });
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
            take: 50,
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

// --- Catch-all route for SPA ---
// This must be AFTER all API routes. It sends the main HTML file for any non-API GET request.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- Bot Startup and Shutdown Logic ---
function startPythonBot() {
    if (pythonBotProcess && !pythonBotProcess.killed) {
        console.log('Python bot is already running.');
        return;
    }

    console.log('Starting Python Discord bot...');
    pythonBotProcess = spawn(process.platform === "win32" ? 'python' : 'python3', ['main.py'], {
        stdio: 'inherit',
    });

    pythonBotProcess.on('spawn', () => console.log('Python Discord bot process spawned successfully.'));
    pythonBotProcess.on('error', (err) => {
        console.error('Failed to start Python Discord bot:', err);
        pythonBotProcess = null;
    });
    pythonBotProcess.on('exit', (code, signal) => {
        console.log(`Python Discord bot process exited with code ${code} and signal ${signal}`);
        pythonBotProcess = null;
        if (code !== 0 && signal !== 'SIGINT') { 
            console.log('Attempting to restart Python bot in 5 seconds...');
            setTimeout(startPythonBot, 5000);
        }
    });
}

// Start the server
server.listen(PORT, () => {
    console.log(`Node.js Server is running on http://localhost:${PORT}`);
    startPythonBot(); 
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('SIGINT signal received. Shutting down...');
    if (pythonBotProcess && !pythonBotProcess.killed) {
        console.log('Stopping Python Discord bot...');
        pythonBotProcess.kill('SIGINT');
    }
    await prisma.$disconnect();
    setTimeout(() => process.exit(0), 2000);
});
