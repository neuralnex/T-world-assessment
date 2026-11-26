import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ContractConversion, TokenTransaction, User } from '../models.js';

const router = Router();
const convertSchema = z.object({
  toAsset: z.enum(['MOCK_USDT', 'MOCK_ETH']),
  amount: z.number().int().positive().max(1000000),
});

function validationError(res, error) {
  return res.status(400).json({ error: error.issues[0]?.message || 'Invalid request data' });
}

router.get('/tokens/balance', async (req, res) => {
  res.json({ userId: req.user._id, tokenBalance: req.user.tokenBalance });
});

router.get('/tokens/history', async (req, res, next) => {
  try {
    const history = await TokenTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100);
    res.json({ transactions: history });
  } catch (error) { next(error); }
});

router.post('/tokens/convert', async (req, res, next) => {
  const parsed = convertSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { toAsset, amount } = parsed.data;
  const exchangeRate = toAsset === 'MOCK_USDT' ? 1 / 100 : 1 / 20000;
  const convertedAmount = Number((amount * exchangeRate).toFixed(toAsset === 'MOCK_USDT' ? 2 : 6));
  const session = await mongoose.startSession();
  const txHashMock = `0x${randomBytes(16).toString('hex')}`;
  let conversion;
  let balanceAfter;
  try {
    await session.withTransaction(async () => {
      const user = await User.findOneAndUpdate(
        { _id: req.user._id, tokenBalance: { $gte: amount } },
        { $inc: { tokenBalance: -amount } },
        { new: true, session },
      );
      if (!user) throw Object.assign(new Error('Your token balance is too low for this conversion'), { status: 409 });
      balanceAfter = user.tokenBalance;
      [conversion] = await ContractConversion.create([{
        userId: user._id, toAsset, amount, exchangeRate, convertedAmount, txHashMock,
      }], { session });
      await TokenTransaction.create([{
        userId: user._id, type: 'CONVERT', source: 'SYSTEM', amount, balanceAfter, referenceId: conversion._id,
      }], { session });
    });
    res.status(201).json({
      conversion,
      txHashMock,
      convertedAmount: `${convertedAmount} ${toAsset}`,
      totalTokenBalance: balanceAfter,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally { await session.endSession(); }
});

router.post('/tokens/withdraw', async (req, res, next) => {
  const schema = z.object({ conversionId: z.string().refine(mongoose.isValidObjectId, 'Conversion id is invalid') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const session = await mongoose.startSession();
  const txHashMock = `0x${randomBytes(16).toString('hex')}`;
  let conversion;
  try {
    await session.withTransaction(async () => {
      conversion = await ContractConversion.findOneAndUpdate(
        { _id: parsed.data.conversionId, userId: req.user._id, status: 'CONVERTED' },
        { $set: { status: 'WITHDRAWN', withdrawnAt: new Date() } },
        { new: true, session },
      );
      if (!conversion) throw Object.assign(new Error('This conversion cannot be withdrawn'), { status: 409 });
      await TokenTransaction.create([{
        userId: req.user._id,
        type: 'WITHDRAW',
        source: 'SYSTEM',
        amount: 0,
        balanceAfter: req.user.tokenBalance,
        referenceId: conversion._id,
      }], { session });
    });
    res.json({ status: 'SUCCESS', network: 'Ethereum', txHashMock, conversion });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally { await session.endSession(); }
});

router.get('/tokens/conversions', async (req, res, next) => {
  try {
    const conversions = await ContractConversion.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json({ conversions });
  } catch (error) { next(error); }
});

export default router;
