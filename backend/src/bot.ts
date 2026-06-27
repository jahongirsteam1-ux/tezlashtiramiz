import { Telegraf, Markup } from 'telegraf';
import { prisma } from './prisma';
import 'dotenv/config';
import cron from 'node-cron';

export const bot = new Telegraf(process.env.BOT_TOKEN || 'dummy');

function getAdminIds(): string[] {
  const adminId = process.env.ADMIN_ID;
  if (!adminId) return [];
  return adminId.split(',').map(id => id.trim()).filter(id => id.length > 0);
}

function isAdmin(userId: string): boolean {
  return getAdminIds().includes(userId);
}

// ============ COMMANDS ============

bot.start(async (ctx) => {
  const user = ctx.from;
  if (user) {
    await prisma.user.upsert({
      where: { id: user.id.toString() },
      update: { username: user.username, firstName: user.first_name },
      create: { id: user.id.toString(), username: user.username, firstName: user.first_name }
    });
  }
  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
  await ctx.reply(
    "🌟 Salom! VIP kanallarga obuna bo'lish uchun pastdagi tugmani bosing.",
    Markup.inlineKeyboard([Markup.button.webApp('🚀 Obunalarni boshqarish', webAppUrl)])
  );
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id.toString())) return;
  const webAppUrl = process.env.WEBAPP_URL || 'https://google.com';
  await ctx.reply(
    '🛠 Admin Panelga xush kelibsiz!',
    Markup.inlineKeyboard([Markup.button.webApp('⚙️ Boshqaruv Paneli', `${webAppUrl}?admin=true`)])
  );
});

bot.command('mystatus', async (ctx) => {
  const userId = ctx.from.id.toString();
  try {
    const subs = await prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { channel: true }
    });
    if (subs.length === 0) {
      return ctx.reply("📭 Sizda hozircha faol obunalar yo'q.\n\nObuna bo'lish uchun /start buyrug'ini yuboring.");
    }
    let text = '📋 **Sizning obunalaringiz:**\n\n';
    for (const sub of subs) {
      const expiresAt = new Date(sub.expiresAt);
      const now = new Date();
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      text += `📺 **${sub.channel.title}**\n`;
      if (daysLeft > 3650) {
        text += `   📅 Tugash: Butun umrlik\n   ⏳ Qoldi: Cheklanmagan\n\n`;
      } else {
        text += `   📅 Tugash: ${expiresAt.toLocaleDateString('uz-UZ')}\n   ⏳ Qoldi: ${daysLeft > 0 ? daysLeft + ' kun' : '⚠️ Bugun tugaydi!'}\n\n`;
      }
    }
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('mystatus error:', err);
    await ctx.reply("Xatolik yuz berdi. Qaytadan urinib ko'ring.");
  }
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 **Bot buyruqlari:**\n\n/start — Botni ishga tushirish\n/mystatus — Faol obunalarni ko\'rish\n/help — Yordam',
    { parse_mode: 'Markdown' }
  );
});

// ============ CHANNEL POST LISTENER (Auto-verify payments) ============

/**
 * Matndan barcha sonlarni ajratib oladi:
 * - Butun sonlar: "200 560", "200000"
 * - Desimal sonlar: "1313,54", "1313.54", "1 313,54"
 */
function extractNumbers(text: string): number[] {
  const results = new Set<number>();

  // 1. Desimal sonlar (vergul yoki nuqta bilan, 1-2 o'rin): "1313,54" | "1 313.54"
  const decimalPattern = /\b(\d[\d\s]*)([,.])([\d]{1,2})\b/g;
  let match;
  while ((match = decimalPattern.exec(text)) !== null) {
    const intStr = match[1].replace(/\s/g, '');
    const decStr = match[3];
    // Faqat 2 o'rinli kasrlar rubil uchun muhim: ,54 | .54
    if (decStr.length === 2) {
      const num = parseFloat(`${intStr}.${decStr}`);
      if (!isNaN(num) && num > 0) results.add(Math.round(num * 100) / 100);
    }
  }

  // 2. Butun sonlar (bo'sh joy, vergul, nuqta bilan ajratilgan mingliklar)
  // Avval .00 va ,00 ni olib tashlaymiz
  let temp = text.replace(/[.,]00\b/g, '');
  const intPattern = /\b\d[\d\s,.]*\b/g;
  while ((match = intPattern.exec(temp)) !== null) {
    const cleanVal = match[0].replace(/[\s,.]/g, '');
    const num = parseInt(cleanVal, 10);
    if (!isNaN(num) && num > 100) results.add(num);
  }

  return Array.from(results);
}

bot.on('channel_post', async (ctx) => {
  const channelId = ctx.chat.id.toString();
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || settings.paymentChannelId !== channelId) return;

  const text = (ctx.channelPost as any).text || '';
  if (!text) return;

  const pendingPayments = await prisma.payment.findMany({
    where: { status: 'PENDING' },
    include: { plan: true, user: true }
  });

  const extractedNumbers = extractNumbers(text);
  const exactMatches: any[] = [];
  const closeMatches: any[] = [];

  for (const num of extractedNumbers) {
    for (const payment of pendingPayments) {
      // Faqat UZS miqdori bo'yicha tekshirish
      // (rubl → so'm o'tkazmada bank avtomatik konvertatsiya qiladi, kanal xabarida UZS keladi)
      if (payment.amount === num) {
        exactMatches.push(payment);
      } else if (Math.abs(payment.amount - num) <= 500) {
        closeMatches.push({ payment, foundAmount: num, expectedAmount: payment.amount });
      }
    }
  }

  if (exactMatches.length > 0) {
    const uniqueExact = exactMatches.filter((p, i, self) => self.findIndex(t => t.id === p.id) === i);

    for (const payment of uniqueExact) {
      try {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED' } });

        const expiresAt = new Date();
        if (payment.plan.duration === 0) expiresAt.setFullYear(expiresAt.getFullYear() + 100);
        else expiresAt.setDate(expiresAt.getDate() + payment.plan.duration);

        await prisma.subscription.create({
          data: {
            userId: payment.userId,
            channelId: payment.plan.channelId,
            expiresAt,
            status: 'ACTIVE'
          }
        });

        const inviteLink = await bot.telegram.createChatInviteLink(payment.plan.channelId, {
          creates_join_request: true,
          expire_date: Math.floor(Date.now() / 1000) + 7 * 86400,
        });

        const durationText = payment.plan.duration === 0 ? 'butun umr' : `${payment.plan.duration} kun`;
        await bot.telegram.sendMessage(
          payment.userId,
          `✅ To'lovingiz (${payment.amount} so'm) tasdiqlandi!\n\nObunangiz ${durationText} amal qiladi.\n\nKanalga kirish havolasi (faqat siz uchun, boshqalarga bermang):\n${inviteLink.invite_link}`
        );
      } catch (err) {
        console.error('Auto confirmation error for payment ' + payment.id + ':', err);
        try {
          await bot.telegram.sendMessage(
            payment.userId,
            `✅ To'lovingiz tasdiqlandi, lekin havola yaratishda xatolik. Adminga murojaat qiling.`
          );
        } catch (e) {}
      }
    }
  } else if (closeMatches.length > 0) {
    const uniqueClose = closeMatches.filter((m, i, self) => self.findIndex(t => t.payment.id === m.payment.id) === i);
    const adminIds = getAdminIds();

    for (const match of uniqueClose) {
      const { payment, foundAmount, expectedAmount } = match;
      const usernameVal = payment.user?.username || "yo'q";

      for (const aid of adminIds) {
        await bot.telegram.sendMessage(
          aid,
          `⚠️ Noto'g'ri summa! ${foundAmount} keldi, kutilgan: ${expectedAmount}. To'lov #${payment.id}. @${usernameVal}`
        ).catch(e => console.error('Admin notification error:', e));
      }

      await bot.telegram.sendMessage(
        payment.userId,
        `❌ To'lovingiz ${foundAmount} so'm bo'lib keldi, biz ${expectedAmount} so'm kutgandik. Adminga murojaat qiling.`
      ).catch(e => console.error('User warning error:', e));
    }
  }
});

// ============ INLINE BUTTON CALLBACKS ============

bot.on('callback_query', async (ctx) => {
  const data = (ctx.callbackQuery as any).data;
  if (!data) return;
  if (!isAdmin(ctx.from.id.toString())) return ctx.answerCbQuery('⛔ Siz admin emassiz.');

  const [action, paymentIdStr] = data.split(':');
  const paymentId = parseInt(paymentIdStr);
  if (isNaN(paymentId)) return;

  if (action === 'confirm_pay') {
    try {
      const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { plan: true } });
      if (!payment || payment.status !== 'PENDING') return ctx.answerCbQuery("⚠️ Bu to'lov allaqachon qayta ishlangan.");

      await prisma.payment.update({ where: { id: paymentId }, data: { status: 'COMPLETED' } });

      const expiresAt = new Date();
      if (payment.plan.duration === 0) expiresAt.setFullYear(expiresAt.getFullYear() + 100);
      else expiresAt.setDate(expiresAt.getDate() + payment.plan.duration);

      await prisma.subscription.create({
        data: { userId: payment.userId, channelId: payment.plan.channelId, expiresAt, status: 'ACTIVE' }
      });

      try {
        const inviteLink = await bot.telegram.createChatInviteLink(payment.plan.channelId, {
          creates_join_request: true,
          expire_date: Math.floor(Date.now() / 1000) + 7 * 86400,
        });
        const durationText = payment.plan.duration === 0 ? 'butun umr' : `${payment.plan.duration} kun`;
        await bot.telegram.sendMessage(
          payment.userId,
          `✅ To'lovingiz (${payment.amount} so'm) tasdiqlandi!\n\nObunangiz ${durationText} amal qiladi.\n\nKanalga kirish havolasi:\n${inviteLink.invite_link}`
        );
      } catch (err) {
        await bot.telegram.sendMessage(payment.userId, `✅ To'lovingiz tasdiqlandi! Adminga murojaat qiling.`).catch(() => {});
      }

      await ctx.editMessageText((ctx.callbackQuery as any).message.text + '\n\n✅ TASDIQLANDI', { reply_markup: undefined });
      await ctx.answerCbQuery('✅ Tasdiqlandi!');
    } catch (err) {
      await ctx.answerCbQuery('❌ Xatolik yuz berdi');
    }
  } else if (action === 'reject_pay') {
    try {
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.status !== 'PENDING') return ctx.answerCbQuery("⚠️ Bu to'lov allaqachon qayta ishlangan.");

      await prisma.payment.update({ where: { id: paymentId }, data: { status: 'CANCELLED' } });
      await bot.telegram.sendMessage(payment.userId, `❌ To'lovingiz (${payment.amount} so'm) qabul qilinmadi.`).catch(() => {});

      await ctx.editMessageText((ctx.callbackQuery as any).message.text + '\n\n❌ BEKOR QILINDI', { reply_markup: undefined });
      await ctx.answerCbQuery('❌ Bekor qilindi');
    } catch (err) {
      await ctx.answerCbQuery('❌ Xatolik yuz berdi');
    }
  }
});

// ============ CHAT JOIN REQUEST ============

bot.on('chat_join_request', async (ctx) => {
  const userId = ctx.chatJoinRequest.from.id.toString();
  const channelId = ctx.chatJoinRequest.chat.id.toString();
  const channelTitle = ctx.chatJoinRequest.chat.title || 'VIP';

  try {
    const activeSub = await prisma.subscription.findFirst({ where: { userId, channelId, status: 'ACTIVE' } });
    if (activeSub) {
      await bot.telegram.approveChatJoinRequest(channelId, ctx.chatJoinRequest.from.id);
      await bot.telegram.sendMessage(userId, `🎉 "${channelTitle}" kanaliga kirish tasdiqlandi!`).catch(() => {});
    } else {
      await bot.telegram.declineChatJoinRequest(channelId, ctx.chatJoinRequest.from.id);
      await bot.telegram.sendMessage(userId, `⚠️ "${channelTitle}" kanaliga faol obunangiz yo'q. /start ni bosing.`).catch(() => {});
    }
  } catch (err) {
    console.error(`[Join Request] Error:`, err);
  }
});

// ============ CRON JOBS ============

export function startSubscriptionCron() {
  setInterval(async () => {
    try {
      const expiredSubs = await prisma.subscription.findMany({
        where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
        include: { channel: true, user: true }
      });
      for (const sub of expiredSubs) {
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
        try {
          await bot.telegram.banChatMember(sub.channelId, parseInt(sub.userId));
          await bot.telegram.unbanChatMember(sub.channelId, parseInt(sub.userId));
        } catch (err) {}
        try {
          await bot.telegram.sendMessage(sub.userId, `⏰ "${sub.channel.title}" kanaliga obunangiz tugadi. /start ni bosing.`);
        } catch (err) {}
      }
      if (expiredSubs.length > 0) console.log(`[CRON] ${expiredSubs.length} obuna muddati tugadi.`);
    } catch (err) {
      console.error('[CRON] Subscription expiry error:', err);
    }
  }, 60 * 60 * 1000);
}

function getTashkentTomorrowRange() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', year: 'numeric', month: 'numeric', day: 'numeric' });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);
  const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:00`;
  const today = new Date(todayStr);
  return { start: new Date(today.getTime() + 86400000), end: new Date(today.getTime() + 2 * 86400000) };
}

export function startExpiryWarningCron() {
  cron.schedule('0 9,15,19 * * *', async () => {
    try {
      const { start, end } = getTashkentTomorrowRange();
      const expiringSoon = await prisma.subscription.findMany({
        where: { status: 'ACTIVE', expiresAt: { gte: start, lt: end } },
        include: { channel: true }
      });
      for (const sub of expiringSoon) {
        try {
          await bot.telegram.sendMessage(sub.userId, `⚠️ "${sub.channel.title}" kanaliga obunangiz ertaga tugaydi! /start ni bosing.`);
        } catch (err) {}
      }
    } catch (err) {
      console.error('[CRON] Expiry warning error:', err);
    }
  }, { timezone: 'Asia/Tashkent' });
}

export function startPaymentTimeoutCron() {
  setInterval(async () => {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const expiredPayments = await prisma.payment.findMany({ where: { status: 'PENDING', createdAt: { lt: fifteenMinutesAgo } } });
      if (expiredPayments.length > 0) {
        await prisma.payment.updateMany({ where: { status: 'PENDING', createdAt: { lt: fifteenMinutesAgo } }, data: { status: 'CANCELLED' } });
        for (const pay of expiredPayments) {
          try { await bot.telegram.sendMessage(pay.userId, `⏰ To'lov muddati tugadi (15 daqiqa). /start ni bosing.`); } catch {}
        }
        console.log(`[CRON] ${expiredPayments.length} to'lov bekor qilindi.`);
      }
    } catch (err) {
      console.error('[CRON] Payment timeout error:', err);
    }
  }, 60 * 1000);
}

// ============ ADMIN NOTIFICATION ============

export async function notifyAdminNewPayment(payment: any, user: any, plan: any) {
  const adminIds = getAdminIds();
  if (adminIds.length === 0) return;

  const rubStr = payment.rubAmount ? ` (${payment.rubAmount.toFixed(2)} ₽)` : '';
  const text =
    `💰 **Yangi to'lov!**\n\n` +
    `👤 Ism: ${user.firstName || 'Ismsiz'}\n` +
    `📛 Username: ${user.username ? '@' + user.username : "yo'q"}\n` +
    `💵 Summa: ${payment.amount.toLocaleString()} UZS${rubStr}\n` +
    `📦 Tarif: ${plan.name}\n` +
    `🆔 To'lov ID: #${payment.id}`;

  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendMessage(adminId, text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          Markup.button.callback('✅ Tasdiqlash', `confirm_pay:${payment.id}`),
          Markup.button.callback('❌ Bekor qilish', `reject_pay:${payment.id}`)
        ])
      });
    } catch (err) {
      console.error(`Admin notification error for ${adminId}:`, err);
    }
  }
}
