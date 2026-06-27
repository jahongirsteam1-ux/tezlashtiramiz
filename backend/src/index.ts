import { app } from './api';
import { bot, startSubscriptionCron, startExpiryWarningCron, startPaymentTimeoutCron } from './bot';
import { prisma } from './prisma';

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function bootstrap() {
  // ALWAYS Start API immediately so Railway doesn't kill the container due to timeout
  app.listen(PORT, () => {
    console.log(`[API] Server is running on port ${PORT}`);
  });

  try {
    // Dummy ma'lumotlar bilan to'ldirish (agar bo'sh bo'lsa)
    const channelCount = await prisma.channel.count();
    if (channelCount === 0) {
      console.log("Seeding initial data...");
      const ch = await prisma.channel.create({
        data: {
          id: "-1001234567890", // dummy telegram chat id
          title: "IT Dasturlash - Premium VIP",
          adminId: "123456789",
        }
      });
      await prisma.plan.create({
        data: {
          channelId: ch.id,
          name: "1 Oylik VIP Obuna",
          description: "Barcha maxfiy darslar va materiallarga 30 kunlik ruxsat",
          price: 100000, // 100,000 UZS
          priceType: "UZS",
          duration: 30
        }
      });
      await prisma.plan.create({
        data: {
          channelId: ch.id,
          name: "3 Oylik VIP Obuna",
          description: "90 kunlik ruxsat + shaxsiy ustoz yordami",
          price: 250000, // 250,000 UZS
          priceType: "UZS",
          duration: 90
        }
      });
    }

    // Start Bot
    if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'dummy') {
      try {
        await bot.launch({
          allowedUpdates: [
            'message',
            'channel_post',
            'callback_query',
            'chat_join_request'
          ]
        });
        console.log(`[Bot] Telegram bot started.`);
      } catch (botErr) {
        console.error(`[Bot] Failed to start telegram bot:`, botErr);
      }
    } else {
      console.log(`[Bot] Skipping bot launch, no valid BOT_TOKEN provided.`);
    }

    // Start Cron Jobs
    startSubscriptionCron();
    startExpiryWarningCron();
    startPaymentTimeoutCron();
    console.log('[CRON] All cron jobs started.');
  } catch (err) {
    console.error("Bootstrap error:", err);
  }

}

bootstrap();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
