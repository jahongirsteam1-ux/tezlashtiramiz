"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("./api");
const bot_1 = require("./bot");
const cron_1 = require("./cron");
const prisma_1 = require("./prisma");
const PORT = process.env.PORT || 3000;
async function bootstrap() {
    try {
        // Dummy ma'lumotlar bilan to'ldirish (agar bo'sh bo'lsa)
        const channelCount = await prisma_1.prisma.channel.count();
        if (channelCount === 0) {
            console.log("Seeding initial data...");
            const ch = await prisma_1.prisma.channel.create({
                data: {
                    id: "-1001234567890", // dummy telegram chat id
                    title: "IT Dasturlash - Premium VIP",
                    adminId: "123456789",
                }
            });
            await prisma_1.prisma.plan.create({
                data: {
                    channelId: ch.id,
                    name: "1 Oylik VIP Obuna",
                    description: "Barcha maxfiy darslar va materiallarga 30 kunlik ruxsat",
                    price: 100, // 100 Telegram Stars
                    priceType: "STARS",
                    duration: 30
                }
            });
            await prisma_1.prisma.plan.create({
                data: {
                    channelId: ch.id,
                    name: "3 Oylik VIP Obuna",
                    description: "90 kunlik ruxsat + shaxsiy ustoz yordami",
                    price: 250, // 250 Telegram Stars
                    priceType: "STARS",
                    duration: 90
                }
            });
        }
        // Start API
        api_1.app.listen(PORT, () => {
            console.log(`[API] Server is running on port ${PORT}`);
        });
        // Start Bot
        if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'dummy') {
            bot_1.bot.launch();
            console.log(`[Bot] Telegram bot started.`);
        }
        else {
            console.log(`[Bot] Skipping bot launch, no valid BOT_TOKEN provided.`);
        }
        // Start Cron
        (0, cron_1.startCronJobs)();
    }
    catch (err) {
        console.error("Bootstrap error:", err);
    }
}
bootstrap();
process.once('SIGINT', () => bot_1.bot.stop('SIGINT'));
process.once('SIGTERM', () => bot_1.bot.stop('SIGTERM'));
//# sourceMappingURL=index.js.map