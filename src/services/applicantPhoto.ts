import { put, del } from '@vercel/blob';
import type { ApplicantAvatar } from '../models/store.js';

export const MAX_APPLICANT_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ApplicantPhotoUploadInput {
  applicantId: string;
  body: Buffer;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  extension: 'png' | 'jpg' | 'webp';
  altText: string;
}

export interface ApplicantPhotoStorage {
  upload(input: ApplicantPhotoUploadInput): Promise<ApplicantAvatar>;
  delete(pathname: string): Promise<void>;
}

interface BlobPutResult {
  url: string;
  pathname: string;
  contentType: string;
}

interface BlobClient {
  put(pathname: string, body: Buffer, options: {
    access: 'private';
    contentType: string;
    addRandomSuffix: false;
    allowOverwrite: false;
  }): Promise<BlobPutResult>;
  del(pathname: string): Promise<void>;
}

const defaultBlobClient: BlobClient = {
  put: (pathname, body, options) => put(pathname, body, options),
  del: (pathname) => del(pathname),
};

export class VercelApplicantPhotoStorage implements ApplicantPhotoStorage {
  constructor(private readonly client: BlobClient = defaultBlobClient) {}

  async upload(input: ApplicantPhotoUploadInput): Promise<ApplicantAvatar> {
    const safeApplicantId = input.applicantId.replace(/[^A-Za-z0-9_-]/g, '_');
    const pathname = `applicants/${safeApplicantId}/profile-${crypto.randomUUID()}.${input.extension}`;
    const blob = await this.client.put(pathname, input.body, {
      access: 'private',
      contentType: input.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return {
      kind: 'upload',
      icon: 'person',
      altText: input.altText,
      provider: 'vercel-blob',
      url: blob.url,
      pathname: blob.pathname,
      contentType: input.contentType,
      size: input.body.length,
    };
  }

  async delete(pathname: string): Promise<void> {
    await this.client.del(pathname);
  }
}

export interface PhotoValidationResult {
  valid: boolean;
  status: 400 | 413;
  error?: string;
  contentType?: ApplicantPhotoUploadInput['contentType'];
  extension?: ApplicantPhotoUploadInput['extension'];
}

function isPng(body: Buffer): boolean {
  return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(body: Buffer): boolean {
  return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
}

function isWebp(body: Buffer): boolean {
  return body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function validateApplicantPhoto(body: unknown, rawContentType: unknown): PhotoValidationResult {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return { valid: false, status: 400, error: 'Applicant photo body is required' };
  }
  if (body.length > MAX_APPLICANT_PHOTO_BYTES) {
    return { valid: false, status: 413, error: 'Applicant photo must be 4 MB or smaller' };
  }
  const contentType = typeof rawContentType === 'string' ? rawContentType.split(';', 1)[0].trim().toLowerCase() : '';
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return { valid: false, status: 400, error: 'Applicant photo must be PNG, JPEG, or WebP' };
  }

  const detected = isPng(body) ? 'image/png' : isJpeg(body) ? 'image/jpeg' : isWebp(body) ? 'image/webp' : null;
  if (!detected || detected !== contentType) {
    return { valid: false, status: 400, error: 'Applicant photo content does not match its Content-Type' };
  }
  const extension = detected === 'image/png' ? 'png' : detected === 'image/jpeg' ? 'jpg' : 'webp';
  return {
    valid: true,
    status: 400,
    contentType: detected,
    extension,
  };
}

export const applicantPhotoStorage = new VercelApplicantPhotoStorage();
