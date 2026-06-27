"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCronJobs = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("./prisma");
const bot_1 = require("./bot");
const startCronJobs = () => {
    // Run every hour to check for expired subscriptions
    node_cron_1.default.schedule('0 * * * *', async () => {
        console.log('Running cron to check expired subscriptions...');
        const now = new Date();
        const expiredSubs = await prisma_1.prisma.subscription.findMany({
            where: {
                status: 'ACTIVE',
                expiresAt: { lt: now }
            }
        });
        for (const sub of expiredSubs) {
            try {
                // 1. Kick user from channel (ban then unban so they can rejoin later)
                await bot_1.bot.telegram.banChatMember(sub.channelId, Number(sub.userId));
                await bot_1.bot.telegram.unbanChatMember(sub.channelId, Number(sub.userId));
                // 2. Mark as expired
                await prisma_1.prisma.subscription.update({
                    where: { id: sub.id },
                    data: { status: 'EXPIRED' }
                });
                // 3. Notify user
                await bot_1.bot.telegram.sendMessage(sub.userId, `❌ Obunangiz yakunlandi va siz kanaldan o'chirildingiz. Qayta qo'shilish uchun bot orqali obunani yangilang.`);
            }
            catch (err) {
                console.error(`Error kicking user ${sub.userId} from channel ${sub.channelId}:`, err);
            }
        }
    });
    console.log("Cron jobs started.");
};
exports.startCronJobs = startCronJobs;
//# sourceMappingURL=cron.js.map