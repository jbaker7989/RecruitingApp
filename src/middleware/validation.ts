import { Request, Response, NextFunction } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';

// Body validation helper
export function validateEmail(email: string): boolean {
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(email);
}

export function validateApplicationBody(body: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!body.firstName?.trim()) errors.push('firstName is required');
  if (!body.lastName?.trim()) errors.push('lastName is required');
  if (!body.email?.trim()) errors.push('email is required');
  if (!validateEmail(body.email)) errors.push('Invalid email format');
  if (!body.phone?.trim()) errors.push('phone is required');
  if (!body.address?.state) errors.push('address.state is required');
  if (!body.address?.zip) errors.push('address.zip is required');
  if (!body.educationHistory?.length) errors.push('educationHistory is required');
  if (!body.employmentHistory?.length) errors.push('employmentHistory is required');
  if (body.rightToWork !== true) errors.push('rightToWork must be true');

  return { valid: errors.length === 0, errors };
}

export function validateJobBody(body: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!body.jobTitle?.trim()) errors.push('jobTitle is required');
  if (!body.companyId?.trim()) errors.push('companyId is required');
  if (!body.positionDescription?.trim()) errors.push('positionDescription is required');
  if (!body.requiredSkills?.length) errors.push('requiredSkills is required');
  if (!body.totalOpenings || body.totalOpenings < 1) errors.push('totalOpenings must be >= 1');

  return { valid: errors.length === 0, errors };
}

// Parse multipart form data for file upload (simplified)
export function parseUploadedFile(req: Request): { buffer: Buffer; format: string } | null {
  // For now, expect file in req.body.file or req.file
  const file = (req as any).file || (req.body && req.body.file);
  if (!file) return null;

  const buffer = file instanceof Buffer ? file : Buffer.from(file);
  const format = file.name?.split('.').pop() || 'json';
  
  return { buffer, format };
}
