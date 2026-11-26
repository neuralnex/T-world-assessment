import { Router } from 'express';
import mongoose from 'mongoose';
import { AiRun, ContractConversion, TokenTransaction, User } from '../models.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/admin/users', requireAdmin, async (_req, res, next) => {
  try {
    const users = await User.find({}, 'email role tokenBalance createdAt').sort({ createdAt: -1 }).limit(100);
    res.json({ users });
  } catch (error) { next(error); }
});

router.get('/admin/users/:userId/tokens/history', requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ error: 'User id is invalid' });
    const user = await User.findById(req.params.userId, 'email tokenBalance');
    if (!user) return res.status(404).json({ error: 'User was not found' });
    const transactions = await TokenTransaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100);
    res.json({ user, transactions });
  } catch (error) { next(error); }
});

router.get('/admin/ai-runs', requireAdmin, async (_req, res, next) => {
  try {
    const runs = await AiRun.find().populate('userId', 'email').populate('contentId', 'title').sort({ createdAt: -1 }).limit(50);
    res.json({ runs });
  } catch (error) { next(error); }
});

router.get('/admin/conversions', requireAdmin, async (_req, res, next) => {
  try {
    const conversions = await ContractConversion.find().populate('userId', 'email').sort({ createdAt: -1 }).limit(50);
    res.json({ conversions });
  } catch (error) { next(error); }
});

export default router;
