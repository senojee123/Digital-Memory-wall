import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const here = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.resolve(here, '..', 'uploads');

const driver = () => (process.env.STORAGE_DRIVER || 'local').toLowerCase();
let s3;
const getS3 = () =>
  (s3 ||= new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  }));

const extFor = (mime, original = '') =>
  path.extname(original).toLowerCase() || '.' + (mime.split('/')[1] || 'bin').replace('quicktime', 'mov');

const s3Base = () =>
  (process.env.S3_PUBLIC_URL || `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com`).replace(/\/$/, '');

/** Stores a file and returns its public URL. */
export async function saveFile(file, folder) {
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extFor(file.mimetype, file.originalname)}`;
  if (driver() === 's3') {
    await getS3().send(
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype, CacheControl: 'public, max-age=31536000' })
    );
    return `${s3Base()}/${key}`;
  }
  const full = path.join(uploadsDir, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, file.buffer);
  return `${(process.env.PUBLIC_API_URL || '').replace(/\/$/, '')}/uploads/${key}`;
}

export async function removeFile(url) {
  if (!url) return;
  try {
    if (driver() === 's3') {
      const key = url.replace(`${s3Base()}/`, '');
      await getS3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    } else {
      const rel = url.split('/uploads/')[1];
      if (rel) await fs.rm(path.join(uploadsDir, rel), { force: true });
    }
  } catch (err) {
    console.warn('Could not remove file', url, err.message);
  }
}
