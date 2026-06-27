import express from 'express';
import cors from 'cors';
import { prisma } from './prisma';
import { bot } from './bot';
import path from 'path';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============ LIVE EXCHANGE RATE (CBU — O'zbekiston Markaziy Banki) ============
// Kurs har 25 daqiqada avtomatik yangilanadi

interface RateCache {
  rate: number;       // 1 RUB = rate UZS
  fetchedAt: number;  // timestamp
}

let rateCache: RateCache | null = null;
const RATE_TTL_MS = 25 * 60 * 1000; // 25 daqiqa

async function fetchCbuRate(): Promise<number | null> {
  try {
    // CBU (cbu.uz) rasmiy API — barcha valyuta kurslari
    const res = await fetch('https://cbu.uz/common/json/', {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`CBU API ${res.status}`);
    const data: any[] = await res.json();
    const rubEntry = data.find((c: any) => c.Ccy === 'RUB');
    if (rubEntry && rubEntry.Rate) {
      const rate = parseFloat(rubEntry.Rate);
      if (rate > 0) return rate;
    }
  } catch (err) {
    console.error('[Rate] CBU API xatolik:', err);
  }
  return null;
}

async function getLiveUzsPerRub(): Promise<number> {
  const now = Date.now();

  // Keshda yangi qiymat bor — qaytarish
  if (rateCache && now - rateCache.fetchedAt < RATE_TTL_MS) {
    return rateCache.rate;
  }

  // Yangi kursni CBU dan olish
  const liveRate = await fetchCbuRate();
  if (liveRate) {
    rateCache = { rate: liveRate, fetchedAt: now };
    console.log(`[Rate] Yangi kurs: 1 RUB = ${liveRate} UZS`);
    return liveRate;
  }

  // Agar API ishlamasa — bazadagi admin sozlamasini ishlatish
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const fallback = settings?.rubRate || 155;
  console.warn(`[Rate] CBU API ishlamadi, zahira kurs: ${fallback}`);
  return fallback;
}

// UZS → RUB konversiya (2 decimal o'rin)
async function uzsToRub(uzs: number): Promise<number> {
  const rate = await getLiveUzsPerRub();
  return Math.round((uzs / rate) * 100) / 100;
}

// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ============ PUBLIC ROUTES ============

// Hozirgi kursni frontendga berish
app.get('/api/exchange-rate', async (req, res) => {
  try {
    const rate = await getLiveUzsPerRub();
    res.json({ uzsPerRub: rate, fetchedAt: rateCache?.fetchedAt || Date.now() });
  } catch (err) {
    res.status(500).json({ error: 'Kursni olishda xatolik' });
  }
});

app.get('/api/channels', async (req, res) => {
  try {
    const channels = await prisma.channel.findMany({ include: { plans: true } });
    res.json(channels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/subscriptions/:userId', async (req, res) => {
  try {
    const subs = await prisma.subscription.findMany({
      where: { userId: req.params.userId, status: 'ACTIVE' },
      include: { channel: true }
    });
    res.json(subs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/create-payment', async (req, res) => {
  const { channelId, planId, userId, promoCode } = req.body;
  
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  try {
    const existing = await prisma.payment.findFirst({
      where: { userId: String(userId), planId, status: 'PENDING' }
    });

    if (existing) {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (existing.createdAt < fifteenMinutesAgo) {
        await prisma.payment.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
      } else {
        return res.json({ payment: existing });
      }
    }

    let basePrice = plan.price;
    let appliedPromo: string | null = null;

    if (promoCode) {
      const promo = await prisma.promoCode.findUnique({ where: { code: promoCode.toUpperCase() } });
      if (promo && promo.active && (promo.maxUses === 0 || promo.usedCount < promo.maxUses)) {
        if (promo.discountType === 'percent') {
          basePrice = Math.round(basePrice * (1 - promo.discountValue / 100));
        } else {
          basePrice = Math.max(basePrice - promo.discountValue, 0);
        }
        appliedPromo = promo.code;
        await prisma.promoCode.update({ where: { id: promo.id }, data: { usedCount: promo.usedCount + 1 } });
      }
    }

    const pendingPayments = await prisma.payment.findMany({
      where: { status: 'PENDING' },
      select: { amount: true }
    });
    const busyAmounts = new Set(pendingPayments.map(p => p.amount));

    let randomSuffix = 0;
    let attempts = 0;
    while (attempts < 100) {
      const testSuffix = Math.floor(Math.random() * 900) + 100;
      const testAmount = basePrice + testSuffix;
      if (!busyAmounts.has(testAmount)) {
        randomSuffix = testSuffix;
        break;
      }
      attempts++;
    }
    if (randomSuffix === 0) randomSuffix = Math.floor(Math.random() * 900) + 100;

    const finalAmount = basePrice + randomSuffix;

    // Hozirgi real kurs bo'yicha aniq rubl miqdori (2 decimal)
    const rubAmount = await uzsToRub(finalAmount);

    const payment = await prisma.payment.create({
      data: {
        userId: String(userId),
        planId,
        amount: finalAmount,
        rubAmount,
        status: 'PENDING',
        promoCode: appliedPromo
      }
    });

    const { notifyAdminNewPayment } = await import('./bot.js');
    const user = await prisma.user.findUnique({ where: { id: String(userId) } });
    await notifyAdminNewPayment(payment, user || { firstName: "Noma'lum", username: null }, plan);

    res.json({ payment, discount: appliedPromo ? true : false });
  } catch (err) {
    console.error('Payment Error:', err);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// ============ ADMIN MIDDLEWARE ============
import { validateWebAppData } from './utils/telegramAuth';

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const isLocalHost = req.hostname === 'localhost';
  if (isLocalHost && process.env.NODE_ENV !== 'production') return next();

  const initData = req.headers['x-telegram-init-data'] as string;
  const botToken = process.env.BOT_TOKEN;
  const adminIdEnv = process.env.ADMIN_ID;

  if (!initData || !botToken) return res.status(401).json({ error: 'Unauthorized' });

  const user = validateWebAppData(initData, botToken);
  const adminIds = adminIdEnv ? adminIdEnv.split(',').map(id => id.trim()) : [];
  if (!user || (adminIds.length > 0 && !adminIds.includes(user.id?.toString()))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

// ============ ADMIN ROUTES ============

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const activeSubs = await prisma.subscription.count({ where: { status: 'ACTIVE' } });
    const totalChannels = await prisma.channel.count();
    res.json({ totalUsers, activeSubs, totalChannels });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/channels', requireAdmin, async (req, res) => {
  const { id, title, adminId } = req.body;
  try {
    const channel = await prisma.channel.create({ data: { id, title, adminId: adminId || '12345' } });
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add channel' });
  }
});

app.delete('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id as string;
    await prisma.plan.deleteMany({ where: { channelId: id } });
    await prisma.subscription.deleteMany({ where: { channelId: id } });
    await prisma.channel.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

app.post('/api/admin/channels/:channelId/plans', requireAdmin, async (req, res) => {
  const channelId = req.params.channelId as string;
  const { name, description, price, duration } = req.body;
  try {
    const plan = await prisma.plan.create({
      data: { channelId, name, description, price: Number(price), duration: Number(duration), priceType: 'UZS' }
    });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add plan' });
  }
});

app.delete('/api/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.payment.deleteMany({ where: { planId: Number(req.params.id) } });
    await prisma.plan.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

app.get('/api/admin/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) settings = await prisma.settings.create({ data: { id: 1 } });
    // Joriy kursni ham qo'shib qaytarish
    const liveRate = await getLiveUzsPerRub();
    res.json({ ...settings, liveRate });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const { cardNumber, paymentChannelId, rubRate } = req.body;
  try {
    const updateData: any = { cardNumber, paymentChannelId };
    if (rubRate !== undefined && rubRate !== '') updateData.rubRate = Number(rubRate);
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: updateData,
      create: { id: 1, cardNumber, paymentChannelId, rubRate: rubRate ? Number(rubRate) : 155 }
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({ include: { subs: { include: { channel: true } } } });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  const { text, imageBase64 } = req.body;
  if (!text && !imageBase64) return res.status(400).json({ error: 'Message required' });
  try {
    const users = await prisma.user.findMany();
    let successCount = 0;
    let imageBuffer: Buffer | null = null;
    if (imageBase64) {
      imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    }
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    let i = 0;
    for (const user of users) {
      try {
        if (imageBuffer) {
          await bot.telegram.sendPhoto(user.id, { source: imageBuffer }, { caption: text || '' });
        } else {
          await bot.telegram.sendMessage(user.id, text);
        }
        successCount++;
      } catch (e) {}
      i++;
      if (i % 30 === 0) await sleep(1000);
    }
    res.json({ success: true, count: successCount });
  } catch (err) {
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

app.get('/api/admin/payments', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const where = status && status !== 'ALL' ? { status } : {};
    const payments = await prisma.payment.findMany({
      where,
      include: { user: true, plan: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
  try {
    const completedPayments = await prisma.payment.findMany({ where: { status: 'COMPLETED' } });
    const totalRevenue = completedPayments.reduce((sum, p) => sum + p.amount, 0);
    res.json({ totalRevenue, totalPayments: completedPayments.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get revenue' });
  }
});

app.get('/api/admin/promos', requireAdmin, async (req, res) => {
  try {
    const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(promos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get promos' });
  }
});

app.post('/api/admin/promos', requireAdmin, async (req, res) => {
  const { code, discountType, discountValue, maxUses } = req.body;
  try {
    const promo = await prisma.promoCode.create({
      data: { code: code.toUpperCase(), discountType: discountType || 'percent', discountValue: Number(discountValue), maxUses: Number(maxUses) || 0 }
    });
    res.json(promo);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create promo' });
  }
});

app.delete('/api/admin/promos/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.promoCode.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete promo' });
  }
});

app.post('/api/validate-promo', async (req, res) => {
  const { code, planId } = req.body;
  try {
    const promo = await prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || !promo.active || (promo.maxUses > 0 && promo.usedCount >= promo.maxUses)) {
      return res.json({ valid: false });
    }
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.json({ valid: false });

    let discountedPrice = plan.price;
    if (promo.discountType === 'percent') {
      discountedPrice = Math.round(plan.price * (1 - promo.discountValue / 100));
    } else {
      discountedPrice = Math.max(plan.price - promo.discountValue, 0);
    }

    const discountedRub = await uzsToRub(discountedPrice);
    res.json({ valid: true, discountedPrice, discountedRub, discountType: promo.discountType, discountValue: promo.discountValue });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
});

app.post('/api/admin/payments/:id/confirm', requireAdmin, async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { plan: true } });
    if (!payment || payment.status !== 'PENDING') return res.status(400).json({ error: 'Invalid payment' });

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
        `✅ To'lovingiz (${payment.amount} so'm) admin tomonidan tasdiqlandi!\n\nObunangiz ${durationText} amal qiladi.\n\nKanalga kirish havolasi (faqat siz uchun):\n${inviteLink.invite_link}`
      );
    } catch (err) {
      console.error('Invite link error:', err);
      await bot.telegram.sendMessage(payment.userId, `✅ To'lovingiz tasdiqlandi! Adminga murojaat qiling.`).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

app.post('/api/admin/payments/:id/reject', requireAdmin, async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== 'PENDING') return res.status(400).json({ error: 'Invalid payment' });

    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'CANCELLED' } });
    await bot.telegram.sendMessage(payment.userId, `❌ To'lovingiz (${payment.amount} so'm) qabul qilinmadi.`).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Rejection failed' });
  }
});

// Public settings endpoint — karta raqami va joriy kurs
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) settings = await prisma.settings.create({ data: { id: 1 } });
    const liveRate = await getLiveUzsPerRub();
    res.json({ cardNumber: settings.cardNumber, uzsPerRub: liveRate });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

const complaints = new Set<string>();

app.post('/api/complaint', async (req, res) => {
  const { userId, paymentId, amount } = req.body;
  if (!userId || !paymentId || !amount) return res.status(400).json({ error: "Noto'g'ri ma'lumotlar!" });

  const key = `${userId}_${paymentId}`;
  if (complaints.has(key)) return res.status(429).json({ error: 'Allaqachon shikoyat yuborgansiz!' });
  complaints.add(key);

  try {
    const adminIdEnv = process.env.ADMIN_ID;
    const adminIds = adminIdEnv ? adminIdEnv.split(',').map(id => id.trim()) : [];
    if (adminIds.length > 0) {
      const dateStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' });
      const message =
        `📞 Shikoyat!\n` +
        `👤 Foydalanuvchi: ${userId}\n` +
        `💰 To'langan summa: ${amount} UZS\n` +
        `🆔 To'lov ID: #${paymentId}\n` +
        `⏰ Vaqt: ${dateStr}\n\n` +
        `Foydalanuvchi to'lov tushmaganligidan shikoyat qilmoqda.`;
      for (const adminId of adminIds) {
        await bot.telegram.sendMessage(adminId, message).catch(e => console.error(e));
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Shikoyat yuborishda xatolik' });
  }
});

// Static files
app.use(express.static(path.join(__dirname, '../../frontend/dist'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

app.use((req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const filePath = path.join(__dirname, '../../frontend/dist/index.html');
  res.sendFile(filePath, (err) => {
    if (err) res.status(500).send('Frontend yuklanmagan. Biroz kuting.');
  });
});
