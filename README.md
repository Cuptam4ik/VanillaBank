# VanillaBank

Банковское приложение с веб-интерфейсом, разработанное на Node.js и Express.

## Функциональность

- Регистрация и авторизация пользователей
- Управление банковскими картами
- Система транзакций
- Административная панель
- Система штрафов
- Интеграция с Python-ботом

## Технологии

- Node.js
- Express.js
- Socket.IO
- Prisma (ORM)
- SQLite
- HTML/CSS/JavaScript

## Установка

1. Клонируйте репозиторий:
```bash
git clone https://github.com/your-username/VanillaBank.git
cd VanillaBank
```

2. Установите зависимости:
```bash
npm install
```

3. Настройте базу данных:
```bash
npx prisma migrate dev
```

4. Запустите сервер:
```bash
npm run dev
```

## Конфигурация

Создайте файл `.env` в корневой директории проекта со следующими параметрами:
```
DATABASE_URL="file:./dev.db"
SESSION_SECRET="your-secret-key"
```

## Лицензия

MIT 