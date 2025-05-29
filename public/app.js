// public/app.js
document.addEventListener('DOMContentLoaded', () => {
    const loginSection = document.getElementById('login-section');
    const mainAppSection = document.getElementById('main-app');
    const loginNicknameInput = document.getElementById('login-nickname');
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const welcomeMessage = document.getElementById('welcome-message');
    const userBalanceSpan = document.getElementById('user-balance');
    const userCardNumberSpan = document.getElementById('user-card-number');
    const actionResultDiv = document.getElementById('action-result');

    const playerActionsDiv = document.getElementById('player-actions');
    const bankerActionsDiv = document.getElementById('banker-actions');
    const adminActionsDiv = document.getElementById('admin-actions');

    let currentUser = null; // { nickname, balance, isAdmin, isBanker }

    // --- Helper Functions ---
    function showResult(message, isError = false) {
        actionResultDiv.innerHTML = `<p class="${isError ? 'error' : 'success'}">${message}</p>`;
    }

    async function apiCall(endpoint, method, body) {
        try {
            const response = await fetch(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : null,
            });
            const data = await response.json();
            if (!response.ok) {
                showResult(data.message || `Ошибка ${response.status}`, true);
                return null;
            }
            return data;
        } catch (error) {
            console.error('API Call Error:', error);
            showResult('Сетевая ошибка или сервер недоступен.', true);
            return null;
        }
    }

    function updateUIForUser() {
        if (currentUser) {
            loginSection.style.display = 'none';
            mainAppSection.style.display = 'block';
            welcomeMessage.textContent = `Добро пожаловать, ${currentUser.nickname}!`;
            userBalanceSpan.textContent = currentUser.balance;
            userCardNumberSpan.textContent = currentUser.cardNumber;

            playerActionsDiv.style.display = 'block'; // Всегда доступно
            bankerActionsDiv.style.display = currentUser.isBanker ? 'block' : 'none';
            adminActionsDiv.style.display = currentUser.isAdmin ? 'block' : 'none';
        } else {
            loginSection.style.display = 'block';
            mainAppSection.style.display = 'none';
            playerActionsDiv.style.display = 'none';
            bankerActionsDiv.style.display = 'none';
            adminActionsDiv.style.display = 'none';
            actionResultDiv.innerHTML = '<p>Результаты действий здесь...</p>';
        }
    }

    // --- Event Listeners ---
    loginButton.addEventListener('click', async () => {
        const nickname = document.getElementById('login-nickname').value.trim();
        if (!nickname) {
            showResult('Пожалуйста, введите никнейм.', true);
            return;
        }
        const data = await apiCall('/api/login', 'POST', { nickname });
        if (data && data.user) {
            currentUser = data.user;
            localStorage.setItem('bankAppUser', JSON.stringify(currentUser));
            showResult(data.message || 'Вход успешен!');
            updateUIForUser();
        }
    });

    logoutButton.addEventListener('click', () => {
        currentUser = null;
        localStorage.removeItem('bankAppUser');
        updateUIForUser();
        loginNicknameInput.value = ''; // Очищаем поле ввода ника
        showResult('Вы вышли из системы.');
    });

     // Player Actions
     document.getElementById('transfer-button').addEventListener('click', async () => {
        if (!currentUser) return;
        const receiverCardNumber = document.getElementById('transfer-receiver').value.trim();
        const amount = parseInt(document.getElementById('transfer-amount').value, 10);

        if (!receiverCardNumber || !amount || amount <= 0) {
            showResult('Введите корректные данные для перевода.', true);
            return;
        }
        const data = await apiCall('/api/player/transfer', 'POST', {
            senderCardNumber: currentUser.cardNumber,
            receiverCardNumber,
            amount
        });
        if (data) {
            showResult(data.message);
            if (data.senderBalance !== undefined) {
                currentUser.balance = data.senderBalance;
                userBalanceSpan.textContent = currentUser.balance; // Обновляем баланс
            }
             // Очистка полей
            document.getElementById('transfer-receiver').value = '';
            document.getElementById('transfer-amount').value = '';
        }
    });

     // Banker Actions
     document.getElementById('deposit-button').addEventListener('click', async () => {
        if (!currentUser || !currentUser.isBanker) return;
        const targetCardNumber = document.getElementById('deposit-target').value.trim();
        const amount = parseInt(document.getElementById('deposit-amount').value, 10);
        const data = await apiCall('/api/banker/deposit', 'POST', {
            bankerCardNumber: currentUser.cardNumber,
            targetCardNumber,
            amount
        });
        if (data) {
            showResult(data.message);
            // Если пополняли себе, обновить баланс
            if (targetCardNumber == currentUser.cardNumber && data.message.includes("New balance")) {
                currentUser.balance = parseInt(data.message.split(": ")[1]);
                userBalanceSpan.textContent = currentUser.balance;
            }
             // Очистка полей
            document.getElementById('deposit-target').value = '';
            document.getElementById('deposit-amount').value = '';
        }
    });

    document.getElementById('withdraw-button').addEventListener('click', async () => {
        if (!currentUser || !currentUser.isBanker) return;
        const targetCardNumber = document.getElementById('withdraw-target').value.trim();
        const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
        const data = await apiCall('/api/banker/withdraw', 'POST', {
            bankerCardNumber: currentUser.cardNumber,
            targetCardNumber,
            amount
        });
        if (data) {
            showResult(data.message);
             // Если отнимали у себя, обновить баланс
            if (targetCardNumber == currentUser.cardNumber && data.message.includes("New balance")) {
                currentUser.balance = parseInt(data.message.split(": ")[1]);
                userBalanceSpan.textContent = currentUser.balance;
            }
            // Очистка полей
            document.getElementById('withdraw-target').value = '';
            document.getElementById('withdraw-amount').value = '';
        }
    });

    document.getElementById('getbalance-button').addEventListener('click', async () => {
        if (!currentUser || !currentUser.isBanker) return;
        const targetCardNumber = document.getElementById('getbalance-target').value.trim();
        const data = await apiCall('/api/banker/balance', 'POST', {
            bankerCardNumber: currentUser.cardNumber,
            targetCardNumber
        });
        if (data) {
            showResult(`Баланс ${data.cardNumber}: ${data.balance}`);
            document.getElementById('getbalance-target').value = '';        }
    });

     // Admin Actions
     document.getElementById('addbanker-button').addEventListener('click', async () => {
        if (!currentUser || !currentUser.isAdmin) return;
        const targetCardNumber = document.getElementById('addbanker-target').value.trim();
        const data = await apiCall('/api/admin/add-banker', 'POST', {
            adminCardNumber: currentUser.cardNumber,
            targetCardNumber
        });
        if (data) {
            showResult(data.message);
             // Если текущий пользователь стал банкиром, обновить его состояние
            if (targetCardNumber == currentUser.cardNumber) {
                currentUser.isBanker = true;
                localStorage.setItem('bankAppUser', JSON.stringify(currentUser));
                bankerActionsDiv.style.display = 'block';
            }
            document.getElementById('addbanker-target').value = '';        }
    });

    document.getElementById('removebanker-button').addEventListener('click', async () => {
        if (!currentUser || !currentUser.isAdmin) return;
        const targetCardNumber = document.getElementById('removebanker-target').value.trim();
        const data = await apiCall('/api/admin/remove-banker', 'POST', {
            adminCardNumber: currentUser.cardNumber,
            targetCardNumber
        });
        if (data) {
            showResult(data.message);
            // Если с текущего пользователя сняли роль банкира
            if (targetCardNumber == currentUser.cardNumber) {
                currentUser.isBanker = false;
                localStorage.setItem('bankAppUser', JSON.stringify(currentUser));
                bankerActionsDiv.style.display = 'none';
            }
            document.getElementById('removebanker-target').value = '';        }
    });

    // --- Initialization ---
    function init() {
        const storedUser = localStorage.getItem('bankAppUser');
        if (storedUser) {
            currentUser = JSON.parse(storedUser);
             // Дополнительно можно сделать запрос на сервер для валидации/обновления данных пользователя
             // Например, /api/user/me, чтобы получить свежие данные, включая баланс.
             // Пока для простоты используем данные из localStorage.
            apiCall('/api/login', 'POST', { nickname: currentUser.nickname }).then(data => {
                if (data && data.user) {
                    currentUser = data.user; // Обновляем currentUser свежими данными с сервера
                    localStorage.setItem('bankAppUser', JSON.stringify(currentUser));
                    updateUIForUser();
                } else {
                    // Если пользователь не найден на сервере (например, удален), разлогиниваем
                    currentUser = null;
                    localStorage.removeItem('bankAppUser');
                    updateUIForUser();
                    showResult('Сессия недействительна, пожалуйста, войдите снова.', true);
                }
            });
        } else {
            updateUIForUser();
        }
    }

    init();
});