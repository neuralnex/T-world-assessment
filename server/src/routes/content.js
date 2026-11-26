import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AiRun, ContentItem, MediaAsset, TokenTransaction, User } from '../models.js';
import { fallbackExcerpt, summarizeContent } from '../services/openRouter.js';

const router = Router();
const tokenReward = 5;
const summarizeSchema = z.object({
  tone: z.enum(['neutral', 'professional', 'friendly']).default('neutral'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
});

function validationError(res, error) {
  return res.status(400).json({ error: error.issues[0]?.message || 'Invalid request data' });
}

function parsePage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

router.post('/content', async (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(180),
      body: z.string().trim().min(1).max(100000),
      tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
      mediaIds: z.array(z.string().refine(mongoose.isValidObjectId, 'Media id is invalid')).max(10).default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const mediaIds = [...new Set(parsed.data.mediaIds)];
    const mediaFilter = { _id: { $in: mediaIds } };
    if (req.user.role !== 'admin') mediaFilter.uploadedBy = req.user._id;
    const availableMedia = mediaIds.length ? await MediaAsset.countDocuments(mediaFilter) : 0;
    if (availableMedia !== mediaIds.length) {
      return res.status(400).json({ error: 'One or more attachments are unavailable to this account' });
    }
    const { mediaIds: _mediaIds, ...contentFields } = parsed.data;
    const content = await ContentItem.create({ ...contentFields, media: mediaIds, createdBy: req.user._id });
    res.status(201).json({ item: content });
  } catch (error) { next(error); }
});

router.get('/content', async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const limit = Math.min(parsePage(req.query.limit || '12'), 50);
    const filter = {};
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim().toLowerCase() : '';
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (typeof req.query.creatorId === 'string') {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can filter posts by creator' });
      if (!mongoose.isValidObjectId(req.query.creatorId)) return res.status(400).json({ error: 'Creator id is invalid' });
      filter.createdBy = req.query.creatorId;
    } else if (req.query.mine === 'true') {
      filter.createdBy = req.user._id;
    }
    if (tag) filter.tags = tag;
    if (query) filter.$text = { $search: query };
    const [items, total] = await Promise.all([
      ContentItem.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('createdBy', 'email')
        .populate('media', 'mimeType cloudinaryUrl s3Url storageProvider'),
      ContentItem.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

router.get('/content/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Content id is invalid' });
    const item = await ContentItem.findById(req.params.id)
      .populate('createdBy', 'email')
      .populate('media', 'mimeType cloudinaryUrl s3Url storageProvider');
    if (!item) return res.status(404).json({ error: 'Content was not found' });
    res.json({ item });
  } catch (error) { next(error); }
});

router.patch('/content/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Content id is invalid' });
    const schema = z.object({
      title: z.string().trim().min(1).max(180).optional(),
      body: z.string().trim().min(1).max(100000).optional(),
      tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
    }).refine((value) => Object.keys(value).length > 0, 'Send at least one field to update');
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const item = await ContentItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Content was not found' });
    if (req.user.role !== 'admin' && !item.createdBy.equals(req.user._id)) return res.status(403).json({ error: 'You can only update content you created' });
    Object.assign(item, parsed.data);
    await item.save();
    res.json({ item });
  } catch (error) { next(error); }
});

router.delete('/content/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Content id is invalid' });
    const item = await ContentItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Content was not found' });
    if (req.user.role !== 'admin' && !item.createdBy.equals(req.user._id)) return res.status(403).json({ error: 'You can only delete content you created' });
    await item.deleteOne();
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post('/content/:id/ai/summarize', async (req, res, next) => {
  const startedAt = Date.now();
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Content id is invalid' });
    const parsed = summarizeSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed.error);
    const content = await ContentItem.findById(req.params.id);
    if (!content) return res.status(404).json({ error: 'Content was not found' });
    let result;
    try {
      result = await summarizeContent({ body: content.body, ...parsed.data });
    } catch (providerError) {
      const latencyMs = Date.now() - startedAt;
      const [run] = await AiRun.create([{
        contentId: content._id,
        userId: req.user._id,
        promptVersion: 'summary-v1',
        provider: 'openrouter',
        model: process.env.OPENROUTER_MODEL,
        status: 'FAILED',
        output: '',
        error: providerError.message,
        latencyMs,
        tokensAwarded: 0,
      }]);
      return res.status(providerError.status || 502).json({
        error: providerError.message,
        fallback: fallbackExcerpt(content.body),
        aiRunId: run._id,
        latencyMs,
        tokensAwarded: 0,
        totalTokenBalance: req.user.tokenBalance,
      });
    }

    const latencyMs = Date.now() - startedAt;
    const session = await mongoose.startSession();
    let run;
    let balance;
    try {
      await session.withTransaction(async () => {
        const [createdRun] = await AiRun.create([{
          contentId: content._id,
          userId: req.user._id,
          promptVersion: result.promptVersion,
          provider: result.provider,
          model: result.model,
          status: 'SUCCEEDED',
          output: result.output,
          latencyMs,
          tokensAwarded: tokenReward,
        }], { session });
        run = createdRun;
        const updatedUser = await User.findOneAndUpdate(
          { _id: req.user._id },
          { $inc: { tokenBalance: tokenReward } },
          { new: true, session },
        );
        balance = updatedUser.tokenBalance;
        await TokenTransaction.create([{
          userId: req.user._id,
          type: 'EARN',
          source: 'AI_USAGE',
          amount: tokenReward,
          balanceAfter: balance,
          referenceId: createdRun._id,
        }], { session });
      });
    } finally { await session.endSession(); }
    res.json({ output: result.output, provider: result.provider, model: result.model, aiRunId: run._id, latencyMs, tokensAwarded: tokenReward, totalTokenBalance: balance });
  } catch (error) { next(error); }
});

export default router;
