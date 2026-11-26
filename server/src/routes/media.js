import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { MediaAsset } from '../models.js';
import { requireAdmin } from '../middleware/auth.js';
import { createStorageName, promoteAsset, removePromotedAsset, storeTemporaryAsset } from '../services/mediaStorage.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    const supported = /^(image\/(png|jpeg|webp|gif)|application\/pdf|video\/(mp4|webm))$/;
    if (!supported.test(file.mimetype)) return done(Object.assign(new Error('Upload a PNG, JPEG, WebP, GIF, PDF, MP4, or WebM file'), { status: 415 }));
    done(null, true);
  },
});

router.post('/media/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
    const stored = await storeTemporaryAsset(req.file);
    const asset = await MediaAsset.create({
      storageName: createStorageName(req.file.mimetype),
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageProvider: stored.provider,
      cloudinaryPublicId: stored.publicId,
      cloudinaryUrl: stored.url,
      uploadedBy: req.user._id,
    });
    res.status(201).json({ asset, note: stored.provider === 'LOCAL_METADATA' ? 'Cloudinary is not configured; metadata was saved for local development.' : undefined });
  } catch (error) { next(error); }
});

router.post('/media/:id/promote', requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Media id is invalid' });
    const asset = await MediaAsset.findById(req.params.id).select('+storageName');
    if (!asset) return res.status(404).json({ error: 'Media asset was not found' });
    if (asset.storageProvider === 'S3' || asset.storageProvider === 'MOCK_S3') return res.status(409).json({ error: 'This asset is already in long-term storage' });
    const promoted = await promoteAsset({ url: asset.cloudinaryUrl, storageName: asset.storageName, mimeType: asset.mimeType });
    try {
      asset.storageProvider = promoted.provider;
      asset.s3Key = promoted.key;
      asset.s3Url = promoted.url;
      await asset.save();
    } catch (error) {
      try { await removePromotedAsset(promoted); }
      catch (cleanupError) { console.error('Could not remove untracked S3 object:', cleanupError.message); }
      throw error;
    }
    res.json({ asset });
  } catch (error) { next(error); }
});

router.get('/media', async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { uploadedBy: req.user._id };
    const assets = await MediaAsset.find(filter).sort({ createdAt: -1 }).limit(50);
    res.json({ assets });
  } catch (error) { next(error); }
});

export default router;
