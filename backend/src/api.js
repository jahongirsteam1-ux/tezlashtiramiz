"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const prisma_1 = require("./prisma");
const bot_1 = require("./bot");
const path_1 = __importDefault(require("path"));
exports.app = (0, express_1.default)();
exports.app.use((0, cors_1.default)());
exports.app.use(express_1.default.json());
// Serve static files from frontend build
exports.app.use(express_1.default.static(path_1.default.join(__dirname, '../../frontend/dist')));
// Get all channels and their plans
exports.app.get('/api/channels', async (req, res) => {
    try {
        const channels = await prisma_1.prisma.channel.findMany({
            include: { plans: true }
        });
        res.json(channels);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
// Get user subscriptions
exports.app.get('/api/subscriptions/:userId', async (req, res) => {
    try {
        const subs = await prisma_1.prisma.subscription.findMany({
            where: { userId: req.params.userId, status: 'ACTIVE' },
            include: { channel: true }
        });
        res.json(subs);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
// Create Invoice Link for Stars
exports.app.post('/api/create-invoice', async (req, res) => {
    const { channelId, planId } = req.body;
    const plan = await prisma_1.prisma.plan.findUnique({ where: { id: planId } });
    const channel = await prisma_1.prisma.channel.findUnique({ where: { id: channelId } });
    if (!plan || !channel) {
        return res.status(404).json({ error: "Plan or Channel not found" });
    }
    try {
        const invoiceLink = await bot_1.bot.telegram.createInvoiceLink({
            title: `${channel.title} VIP`,
            description: `${plan.name} tarifiga obuna - ${plan.duration} kun`,
            payload: `${channelId}_${planId}`,
            provider_token: "", // Empty for Telegram Stars
            currency: "XTR", // Telegram Stars currency code
            prices: [{ label: "Narxi", amount: plan.price }], // amount is in stars, e.g. 100
        });
        res.json({ invoiceLink });
    }
    catch (err) {
        console.error("Invoice Error:", err);
        res.status(500).json({ error: "Failed to create invoice link" });
    }
});
//# sourceMappingURL=api.js.map