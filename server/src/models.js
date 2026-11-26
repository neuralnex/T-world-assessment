import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userSchema = new Schema({
  firebaseUid: { type: String, unique: true, sparse: true, index: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user', index: true },
  tokenBalance: { type: Number, min: 0, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: true } });

const contentSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  body: { type: String, required: true, maxlength: 100000 },
  tags: [{ type: String, trim: true, lowercase: true }],
  media: [{ type: Schema.Types.ObjectId, ref: 'MediaAsset' }],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
contentSchema.index({ tags: 1, createdAt: -1 });
contentSchema.index({ title: 'text', body: 'text' });

const aiRunSchema = new Schema({
  contentId: { type: Schema.Types.ObjectId, ref: 'ContentItem', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  promptVersion: { type: String, required: true },
  provider: { type: String, required: true },
  model: { type: String },
  status: { type: String, enum: ['SUCCEEDED', 'FAILED'], required: true },
  output: { type: String, default: '' },
  error: { type: String },
  latencyMs: { type: Number, min: 0, required: true },
  tokensAwarded: { type: Number, min: 0, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });
aiRunSchema.index({ userId: 1, createdAt: -1 });

const tokenTransactionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['EARN', 'CONVERT', 'WITHDRAW'], required: true },
  source: { type: String, enum: ['AI_USAGE', 'MANUAL', 'SYSTEM'], required: true },
  amount: { type: Number, min: 0, required: true },
  balanceAfter: { type: Number, min: 0, required: true },
  referenceId: { type: Schema.Types.ObjectId },
}, { timestamps: { createdAt: true, updatedAt: false } });
tokenTransactionSchema.index({ userId: 1, createdAt: -1 });
tokenTransactionSchema.index({ referenceId: 1, type: 1 }, { sparse: true });

const conversionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fromToken: { type: String, default: 'TWT' },
  toAsset: { type: String, enum: ['MOCK_USDT', 'MOCK_ETH'], required: true },
  amount: { type: Number, min: 1, required: true },
  exchangeRate: { type: Number, min: 0, required: true },
  convertedAmount: { type: Number, min: 0, required: true },
  txHashMock: { type: String, required: true, unique: true },
  status: { type: String, enum: ['CONVERTED', 'WITHDRAWN'], default: 'CONVERTED' },
  withdrawnAt: { type: Date },
}, { timestamps: { createdAt: true, updatedAt: true } });
conversionSchema.index({ userId: 1, status: 1, createdAt: -1 });

const mediaSchema = new Schema({
  storageName: { type: String, required: true, select: false },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  storageProvider: { type: String, enum: ['CLOUDINARY', 'S3', 'MOCK_S3', 'LOCAL_METADATA'], default: 'CLOUDINARY' },
  cloudinaryPublicId: { type: String },
  cloudinaryUrl: { type: String },
  s3Key: { type: String },
  s3Url: { type: String },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  toJSON: {
    transform: (_document, value) => {
      delete value.storageName;
      delete value.originalName;
      delete value.cloudinaryPublicId;
      delete value.s3Key;
      delete value.s3Url;
      return value;
    },
  },
});

export const User = model('User', userSchema, 'users');
export const ContentItem = model('ContentItem', contentSchema, 'content_items');
export const AiRun = model('AiRun', aiRunSchema, 'ai_runs');
export const TokenTransaction = model('TokenTransaction', tokenTransactionSchema, 'token_transactions');
export const ContractConversion = model('ContractConversion', conversionSchema, 'contract_conversions');
export const MediaAsset = model('MediaAsset', mediaSchema, 'media_assets');
