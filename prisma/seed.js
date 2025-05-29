// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log(`Start seeding ...`);

  // Admin
  await prisma.user.upsert({
    where: { nickname: 'admin1' },
    update: {},
    create: {
      nickname: 'admin1',
      isAdmin: true,
      balance: 1000, // Админу тоже дадим немного денег
    },
  });
  console.log('Admin admin1 created/ensured.');

  // Bankers
  await prisma.user.upsert({
    where: { nickname: 'dogbanker' },
    update: {},
    create: {
      nickname: 'dogbanker',
      isBanker: true,
      balance: 500,
    },
  });
  console.log('Banker dogbanker created/ensured.');

  await prisma.user.upsert({
    where: { nickname: 'catbanker' },
    update: {},
    create: {
      nickname: 'catbanker',
      isBanker: true,
      balance: 500,
    },
  });
  console.log('Banker catbanker created/ensured.');

  // A couple of regular players for testing
  await prisma.user.upsert({
    where: { nickname: 'player1' },
    update: {},
    create: {
      nickname: 'player1',
      balance: 100,
    },
  });
  console.log('Player player1 created/ensured.');

  await prisma.user.upsert({
    where: { nickname: 'player2' },
    update: {},
    create: {
      nickname: 'player2',
      balance: 150,
    },
  });
  console.log('Player player2 created/ensured.');

  console.log(`Seeding finished.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });