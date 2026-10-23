import { Readable } from 'stream';
import Papa from 'papaparse';
import { updateStore, generateId, now, addObservabilityEntry, Company, JobPosting } from '../models/store.js';

export interface ImportResult {
  totalRows: number;
  successes: number;
  failures: number;
  errors: string[];
  jobsCreated: string[];
}

export interface ImportJobRow {
  jobTitle: string;
  positionDescription: string;
  requirements: string;
  positionLocation: string;
  payMin?: number;
  payMax?: number;
  payCurrency?: string;
  responsibilities: string;
  qualifications: string;
  requiredSkills: string;
  requiredExperience: number;
  reportsTo: string;
  totalOpenings: number;
}

// Import jobs from CSV data
export function parseCSV(data: string): ImportJobRow[] {
  const result = Papa.parse<ImportJobRow>(data, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });
  return result.data;
}

// Import jobs from JSON data
export function parseJSON(data: string): ImportJobRow[] {
  const parsed = JSON.parse(data);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed.jobs && Array.isArray(parsed.jobs)) {
    return parsed.jobs;
  }
  throw new Error('Invalid JSON format. Expected array of jobs or { jobs: [...] }');
}

// Process and create jobs from imported rows
export async function processImport(
  rows: ImportJobRow[],
  companyId: string,
  userId: string
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: rows.length,
    successes: 0,
    failures: 0,
    errors: [],
    jobsCreated: [],
  };

  const nowStr = now();
  const created: JobPosting[] = [];
  const audits: Array<Parameters<typeof addObservabilityEntry>[0]> = [];

  for (const row of rows) {
    try {
      const payRange = {
        min: row.payMin || 0,
        max: row.payMax || 0,
        currency: row.payCurrency || 'USD',
      };

      const job: JobPosting = {
        id: generateId(),
        companyId,
        jobTitle: row.jobTitle,
        positionDescription: row.positionDescription,
        requirements: row.requirements ? row.requirements.split(';').map((s: string) => s.trim()) : [],
        positionLocation: row.positionLocation,
        payRange,
        responsibilities: row.responsibilities ? row.responsibilities.split(';').map((s: string) => s.trim()) : [],
        qualifications: row.qualifications ? row.qualifications.split(';').map((s: string) => s.trim()) : [],
        requiredSkills: row.requiredSkills ? row.requiredSkills.split(';').map((s: string) => s.trim()) : [],
        requiredExperience: row.requiredExperience || 0,
        reportsTo: row.reportsTo || 'N/A',
        isActive: true,
        totalOpenings: row.totalOpenings || 1,
        currentApplications: 0,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      created.push(job);
      result.successes++;
      result.jobsCreated.push(job.id);

      audits.push({
        id: generateId(),
        timestamp: nowStr,
        action: 'import_job',
        entityType: 'Job',
        entityId: job.id,
        userId,
        details: { jobTitle: job.jobTitle, companyId },
        outcome: 'success',
      });
    } catch (error) {
      result.failures++;
      result.errors.push(`Row "${row.jobTitle}": ${error}`);

      audits.push({
        id: generateId(),
        timestamp: nowStr,
        action: 'import_job',
        entityType: 'Job',
        entityId: 'unknown',
        userId,
        details: { error: error instanceof Error ? error.message : String(error) },
        outcome: 'failure',
      });
    }
  }

  // All valid rows commit together; audit entries are written only after the commit succeeds.
  if (created.length > 0) await updateStore((store) => { store.jobs.push(...created); });
  for (const entry of audits) await addObservabilityEntry(entry);
  return result;
}

// Import from CSV string
export async function importFromCSV(
  csvData: string,
  companyId: string,
  userId: string
): Promise<ImportResult> {
  const rows = parseCSV(csvData);
  return processImport(rows, companyId, userId);
}

// Import from JSON string
export async function importFromJSON(
  jsonData: string,
  companyId: string,
  userId: string
): Promise<ImportResult> {
  const rows = parseJSON(jsonData);
  return processImport(rows, companyId, userId);
}
