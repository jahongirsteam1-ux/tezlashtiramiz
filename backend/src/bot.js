"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
const telegraf_1 = require("telegraf");
const prisma_1 = require("./prisma");
require("dotenv/config");
exports.bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN || 'dummy');
exports.bot.start(async (ctx) => {
    const user = ctx.from;
    if (user) {
        await prisma_1.prisma.user.upsert({
            where: { id: user.id.toString() },
            update: {
                username: user.username,
                firstName: user.first_name,
            },
            create: {
                id: user.id.toString(),
                username: user.username,
                firstName: user.first_name,
            }
        });
    }
    const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
    await ctx.reply('🌟 Salom! VIP kanallarga obuna bo\'lish va ularni boshqarish uchun pastdagi tugmani bosing.', telegraf_1.Markup.inlineKeyboard([
        telegraf_1.Markup.button.webApp('🚀 Obunalarni boshqarish', webAppUrl)
    ]));
});
exports.bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
});
exports.bot.on('successful_payment', async (ctx) => {
    const paymentInfo = ctx.message.successful_payment;
    const payload = paymentInfo.invoice_payload;
    const [channelId, planIdStr] = payload.split('_');
    const planId = parseInt(planIdStr);
    const plan = await prisma_1.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan)
        return ctx.reply("Tarif topilmadi.");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration);
    await prisma_1.prisma.subscription.create({
        data: {
            userId: ctx.from.id.toString(),
            channelId: channelId,
            expiresAt: expiresAt,
            status: 'ACTIVE'
        }
    });
    try {
        const inviteLink = await ctx.telegram.createChatInviteLink(channelId, {
            member_limit: 1,
            expire_date: Math.floor(Date.now() / 1000) + 86400,
        });
        await ctx.reply(`✅ To'lovingiz muvaffaqiyatli o'tdi!\n\nKanalga kirish uchun maxsus havola (faqat siz uchun, uni boshqalarga bermang):\n${inviteLink.invite_link}`);
    }
    catch (err) {
        console.error("Create link error:", err);
        await ctx.reply("Kanalga havola yaratishda xatolik yuz berdi. Iltimos, adminga murojaat qiling (bot kanalda admin bo'lishi shart).");
    }
});
//# sourceMappingURL=bot.js.map