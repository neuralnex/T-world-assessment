import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

const extensionByMimeType = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export function createStorageName(mimeType) {
  const extension = extensionByMimeType[mimeType];
  if (!extension) throw Object.assign(new Error('Unsupported media type'), { status: 415 });
  return `${randomUUID()}.${extension}`;
}

export function cloudinaryConfigured() {
  return Object.values(config.cloudinary).every(Boolean);
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
}

export async function storeTemporaryAsset(file) {
  if (!cloudinaryConfigured()) {
    return { publicId: null, url: null, provider: 'LOCAL_METADATA' };
  }
  configureCloudinary();
  const resultPromise = new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream({
      folder: 'tworld-assessment',
      resource_type: 'auto',
      public_id: randomUUID(),
    }, (error, result) => error ? reject(error) : resolve(result));
    upload.end(file.buffer);
  });
  const result = await resultPromise;
  return { publicId: result.public_id, url: result.secure_url, provider: 'CLOUDINARY' };
}

function getS3Client() {
  if (!config.awsS3Bucket) throw Object.assign(new Error('AWS_S3_BUCKET is not configured'), { status: 503 });
  const credentials = config.awsAccessKeyId && config.awsSecretAccessKey
    ? { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey }
    : undefined;
  return new S3Client({ region: config.awsRegion, credentials });
}

export async function promoteAsset({ url, storageName, mimeType }) {
  if (!url) throw Object.assign(new Error('Configure Cloudinary to upload this asset before promoting it'), { status: 503 });
  const key = `media/${new Date().toISOString().slice(0, 10)}/${storageName || createStorageName(mimeType)}`;
  if (!config.awsS3Bucket && config.mockS3Enabled) {
    return { key, url: `mock-s3://${key}`, provider: 'MOCK_S3' };
  }

  const response = await fetch(url);
  if (!response.ok) throw Object.assign(new Error('Could not read the temporary Cloudinary asset'), { status: 502 });
  const body = Buffer.from(await response.arrayBuffer());
  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: config.awsS3Bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
  }));
  return { key, url: `s3://${config.awsS3Bucket}/${key}`, client, bucket: config.awsS3Bucket, provider: 'S3' };
}

export async function removePromotedAsset({ client, bucket, key }) {
  if (!client) return;
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
