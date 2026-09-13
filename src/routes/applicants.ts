import { Router, Response, raw } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { validateApplicationBody } from '../middleware/validation.js';
import { requireRole } from '../middleware/auth.js';
import {
  applyProfilePatch,
  createApplicantProfile,
  DEFAULT_AVATAR,
  normalizeApplicantProfile,
  resolveOwnedProfile,
  validateEmploymentEntry,
  validateProfileCreation,
} from '../services/applicantProfile.js';
import {
  applicantPhotoStorage,
  type ApplicantPhotoStorage,
  validateApplicantPhoto,
} from '../services/applicantPhoto.js';

const router = Router();
const parseApplicantPhoto = raw({ type: '*/*', limit: '4.25mb' });

function photoStorage(req: any): ApplicantPhotoStorage {
  return req.app.locals.applicantPhotoStorage || applicantPhotoStorage;
}

function sendOwnershipError(res: Response, status: 'found' | 'missing' | 'ambiguous' | 'forbidden') {
  if (status === 'forbidden') return res.status(403).json({ error: 'Applicant role required' });
  if (status === 'ambiguous') return res.status(409).json({ error: 'Multiple legacy profiles match this account; member-services review required' });
  if (status === 'found') return res.status(500).json({ error: 'Resolved applicant profile is incomplete' });
  return res.status(404).json({ error: 'Applicant profile not found' });
}

async function logProfileAction(req: any, action: string, entityId: string, details: object = {}) {
  await addObservabilityEntry({
    id: generateId(), timestamp: now(), action, entityType: 'Applicant', entityId,
    userId: req.user.id, details, outcome: 'success',
  });
}

// POST /api/applicants/profile - Create the authenticated applicant's owned profile
router.post('/profile', requireRole(['applicant']), async (req: any, res) => {
  try {
    const store = await readStore();
    const user = store.users.find((item) => item.id === req.user.id);
    if (!user) return res.status(401).json({ error: 'Authenticated account not found' });

    const existing = resolveOwnedProfile(store, user.id);
    if (existing.status === 'found') {
      if (existing.changed) await writeStore(store);
      return res.status(409).json({ error: 'Applicant profile already exists' });
    }
    if (existing.status === 'ambiguous') return sendOwnershipError(res, existing.status);

    const validation = validateProfileCreation(req.body, user);
    if (!validation.valid) return res.status(400).json({ errors: validation.errors });
    if (store.applicants.some((item) => item.email.trim().toLowerCase() === req.body.email.trim().toLowerCase())) {
      return res.status(409).json({ error: 'An applicant profile already exists for this email' });
    }

    const profile = createApplicantProfile(req.body, user);
    store.applicants.push(profile);
    await writeStore(store);
    await logProfileAction(req, 'profile_create', profile.id, {
      profileVersion: profile.profileVersion,
      completenessPercent: profile.completeness?.percent,
    });
    res.status(201).json(profile);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create applicant profile' });
  }
});

// GET /api/applicants/me - Get only the authenticated applicant's profile
router.get('/me', requireRole(['applicant']), async (req: any, res) => {
  try {
    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found') return sendOwnershipError(res, owned.status);
    if (owned.changed) await writeStore(store); // persist legacy linkage/normalization
    res.json(owned.profile);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch applicant profile' });
  }
});

// PATCH /api/applicants/me - Safely update allow-listed profile fields
router.patch('/me', requireRole(['applicant']), async (req: any, res) => {
  try {
    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found' || owned.profileIndex === undefined || !owned.profile) return sendOwnershipError(res, owned.status);
    const patched = applyProfilePatch(owned.profile, req.body);
    if (!patched.valid || !patched.value) return res.status(400).json({ errors: patched.errors });
    store.applicants[owned.profileIndex] = patched.value;
    await writeStore(store);
    await logProfileAction(req, 'profile_update', patched.value.id, {
      fields: Object.keys(req.body), profileVersion: patched.value.profileVersion,
      completenessPercent: patched.value.completeness?.percent,
    });
    res.json(patched.value);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update applicant profile' });
  }
});

// POST /api/applicants/me/avatar - Store applicant photo bytes only in private Vercel Blob
router.post('/me/avatar', requireRole(['applicant']), parseApplicantPhoto, async (req: any, res) => {
  try {
    const validation = validateApplicantPhoto(req.body, req.headers['content-type']);
    if (!validation.valid || !validation.contentType || !validation.extension) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const altHeader = req.headers['x-alt-text'];
    const altText = typeof altHeader === 'string' && altHeader.trim()
      ? altHeader.trim()
      : 'Applicant profile photo';
    if (altText.length > 200) return res.status(400).json({ error: 'X-Alt-Text must be <= 200 characters' });

    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found' || owned.profileIndex === undefined || !owned.profile) {
      return sendOwnershipError(res, owned.status);
    }

    const storage = photoStorage(req);
    const previous = owned.profile.avatar;
    const uploaded = await storage.upload({
      applicantId: owned.profile.id,
      body: req.body,
      contentType: validation.contentType,
      extension: validation.extension,
      altText,
    });

    owned.profile.avatar = uploaded;
    owned.profile.profileVersion = (owned.profile.profileVersion || 1) + 1;
    owned.profile.updatedAt = now();
    store.applicants[owned.profileIndex] = normalizeApplicantProfile(owned.profile);
    try {
      await writeStore(store);
    } catch (writeError) {
      if (uploaded.pathname) await storage.delete(uploaded.pathname).catch(() => undefined);
      throw writeError;
    }

    if (previous?.kind === 'upload' && previous.pathname && previous.pathname !== uploaded.pathname) {
      try {
        await storage.delete(previous.pathname);
      } catch (cleanupError) {
        await addObservabilityEntry({
          id: generateId(), timestamp: now(), action: 'avatar_cleanup', entityType: 'Applicant',
          entityId: owned.profile.id, userId: req.user.id,
          details: { reason: cleanupError instanceof Error ? cleanupError.name : 'Blob cleanup failed' },
          outcome: 'failure',
        });
      }
    }
    await logProfileAction(req, 'avatar_upload', owned.profile.id, {
      provider: 'vercel-blob', contentType: uploaded.contentType, size: uploaded.size,
    });
    res.status(201).json(uploaded);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to store applicant photo' });
  }
});

// DELETE /api/applicants/me/avatar - Delete Blob object and restore neutral icon
router.delete('/me/avatar', requireRole(['applicant']), async (req: any, res) => {
  try {
    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found' || owned.profileIndex === undefined || !owned.profile) {
      return sendOwnershipError(res, owned.status);
    }
    const current = owned.profile.avatar;
    if (current?.kind === 'upload' && current.pathname) {
      try {
        await photoStorage(req).delete(current.pathname);
      } catch (error) {
        return res.status(502).json({ error: 'Failed to delete applicant photo from Blob storage' });
      }
    }
    owned.profile.avatar = { ...DEFAULT_AVATAR };
    owned.profile.profileVersion = (owned.profile.profileVersion || 1) + 1;
    owned.profile.updatedAt = now();
    store.applicants[owned.profileIndex] = normalizeApplicantProfile(owned.profile);
    await writeStore(store);
    await logProfileAction(req, 'avatar_delete', owned.profile.id, { provider: 'vercel-blob' });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete applicant photo' });
  }
});

// POST /api/applicants/me/employment - Add detailed employment history entry
router.post('/me/employment', requireRole(['applicant']), async (req: any, res) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'id')) {
      return res.status(400).json({ error: 'employment id is server-generated and protected' });
    }
    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found' || owned.profileIndex === undefined || !owned.profile) return sendOwnershipError(res, owned.status);
    const validation = validateEmploymentEntry(req.body);
    if (!validation.valid || !validation.value) return res.status(400).json({ errors: validation.errors });

    owned.profile.employmentHistory.push(validation.value);
    owned.profile.profileVersion = (owned.profile.profileVersion || 1) + 1;
    owned.profile.updatedAt = now();
    store.applicants[owned.profileIndex] = normalizeApplicantProfile(owned.profile);
    await writeStore(store);
    await logProfileAction(req, 'employment_create', owned.profile.id, {
      employmentId: validation.value.id,
      profileVersion: store.applicants[owned.profileIndex].profileVersion,
    });
    res.status(201).json(validation.value);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to add employment history' });
  }
});

// PUT /api/applicants/me/employment/reorder - Reorder by a complete list of stable entry IDs
router.put('/me/employment/reorder', requireRole(['applicant']), async (req: any, res) => {
  try {
    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found' || owned.profileIndex === undefined || !owned.profile) return sendOwnershipError(res, owned.status);
    const ids = req.body?.ids;
    const current = owned.profile.employmentHistory;
    const currentIds = current.map((entry) => entry.id);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || ids.length !== current.length ||
        new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
      return res.status(400).json({ error: 'ids must contain every employment entry ID exactly once' });
    }
    owned.profile.employmentHistory = ids.map((id: string) => current.find((entry) => entry.id === id)!);
    owned.profile.profileVersion = (owned.profile.profileVersion || 1) + 1;
    owned.profile.updatedAt = now();
    store.applicants[owned.profileIndex] = normalizeApplicantProfile(owned.profile);
    await writeStore(store);
    await logProfileAction(req, 'employment_reorder', owned.profile.id, { count: ids.length });
    res.json(store.applicants[owned.profileIndex].employmentHistory);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reorder employment history' });
  }
});

// PATCH /api/applicants/me/employment/:employmentId - Update an owned entry, preserving its ID
router.patch('/me/employment/:employmentId', requireRole(['applicant']), async (req: any, res) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'id')) return res.status(400).json({ error: 'employment id is protected' });
    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found' || owned.profileIndex === undefined || !owned.profile) return sendOwnershipError(res, owned.status);
    const entryIndex = owned.profile.employmentHistory.findIndex((entry) => entry.id === req.params.employmentId);
    if (entryIndex === -1) return res.status(404).json({ error: 'Employment entry not found' });
    const merged = { ...owned.profile.employmentHistory[entryIndex], ...req.body, id: req.params.employmentId };
    const validation = validateEmploymentEntry(merged);
    if (!validation.valid || !validation.value) return res.status(400).json({ errors: validation.errors });

    owned.profile.employmentHistory[entryIndex] = validation.value;
    owned.profile.profileVersion = (owned.profile.profileVersion || 1) + 1;
    owned.profile.updatedAt = now();
    store.applicants[owned.profileIndex] = normalizeApplicantProfile(owned.profile);
    await writeStore(store);
    await logProfileAction(req, 'employment_update', owned.profile.id, { employmentId: req.params.employmentId });
    res.json(validation.value);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update employment history' });
  }
});

// DELETE /api/applicants/me/employment/:employmentId - Delete an owned entry
router.delete('/me/employment/:employmentId', requireRole(['applicant']), async (req: any, res) => {
  try {
    const store = await readStore();
    const owned = resolveOwnedProfile(store, req.user.id);
    if (owned.status !== 'found' || owned.profileIndex === undefined || !owned.profile) return sendOwnershipError(res, owned.status);
    const entryIndex = owned.profile.employmentHistory.findIndex((entry) => entry.id === req.params.employmentId);
    if (entryIndex === -1) return res.status(404).json({ error: 'Employment entry not found' });
    owned.profile.employmentHistory.splice(entryIndex, 1);
    owned.profile.profileVersion = (owned.profile.profileVersion || 1) + 1;
    owned.profile.updatedAt = now();
    store.applicants[owned.profileIndex] = normalizeApplicantProfile(owned.profile);
    await writeStore(store);
    await logProfileAction(req, 'employment_delete', owned.profile.id, { employmentId: req.params.employmentId });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete employment history' });
  }
});

// POST /api/applicants - Legacy applicant creation endpoint
router.post('/', requireRole(['member-services']), async (req: any, res) => {
  try {
    const validation = validateApplicationBody(req.body);
    if (!validation.valid) return res.status(400).json({ errors: validation.errors });

    const store = await readStore();
    const applicant = {
      id: generateId(),
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone,
      preferredContactMethod: req.body.preferredContactMethod || 'email',
      address: req.body.address || { state: '', zip: '' },
      educationHistory: req.body.educationHistory || [],
      employmentHistory: req.body.employmentHistory || [],
      rightToWork: req.body.rightToWork || false,
      requiresSponsorship: req.body.requiresSponsorship || false,
      expectedPay: req.body.expectedPay || 0,
      notificationToManager: req.body.notificationToManager || false,
      hireRecords: [],
      createdAt: now(),
      updatedAt: now(),
    };

    store.applicants.push(applicant);
    await writeStore(store);
    await addObservabilityEntry({
      id: generateId(), timestamp: now(), action: 'create', entityType: 'Applicant', entityId: applicant.id,
      userId: applicant.id, details: { name: `${applicant.firstName} ${applicant.lastName}` }, outcome: 'success',
    });
    res.status(201).json(applicant);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create applicant' });
  }
});

// GET /api/applicants/:id - Get applicant profile including hireRecords
router.get('/:id', async (req: any, res) => {
  try {
    const store = await readStore();
    const applicant = store.applicants.find((item) => item.id === req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

    const account = store.users.find((user) => user.id === req.user.id);
    const isOwner = req.user.role === 'applicant' &&
      (applicant.userId === req.user.id || account?.applicantId === applicant.id);
    if (req.user.role === 'applicant' && !isOwner) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const hires = store.hires.filter((hire) => hire.applicantId === applicant.id);
    const response: any = { ...normalizeApplicantProfile(applicant), hires };
    // Owner decision: name/photo/email are visible to authorized staff, while
    // phone stays hidden until the post-initial-review stage (not yet modeled).
    if (req.user.role === 'recruiter' || req.user.role === 'hiring-manager') delete response.phone;
    // Compensation is recruiter/member-services only; hiring managers do not
    // receive it through the general profile view.
    if (req.user.role === 'hiring-manager') delete response.expectedPay;
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch applicant' });
  }
});

// PUT /api/applicants/:id - Legacy update, limited to owner or member-services and safe patch fields
router.put('/:id', async (req: any, res) => {
  try {
    const store = await readStore();
    const index = store.applicants.findIndex((item) => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Applicant not found' });
    const account = store.users.find((user) => user.id === req.user.id);
    const isOwner = req.user.role === 'applicant' &&
      (store.applicants[index].userId === req.user.id || account?.applicantId === store.applicants[index].id);
    if (req.user.role !== 'member-services' && !isOwner) return res.status(403).json({ error: 'Insufficient permissions' });

    const patched = applyProfilePatch(normalizeApplicantProfile(store.applicants[index]), req.body);
    if (!patched.valid || !patched.value) return res.status(400).json({ errors: patched.errors });
    store.applicants[index] = patched.value;
    await writeStore(store);
    res.json(patched.value);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update applicant' });
  }
});

// POST /api/applicants/:id/apply - Submit application for a job (legacy convenience endpoint)
router.post('/:id/apply', async (req: any, res) => {
  try {
    const store = await readStore();
    const applicant = store.applicants.find((item) => item.id === req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

    const application = {
      id: generateId(), applicantId: applicant.id, jobPostingId: req.body.jobPostingId,
      status: 'pending' as const, matchScore: 0, keywordMatches: [], educationMatchScore: 0,
      experienceMatchScore: 0, appliedAt: now(), updatedAt: now(), emailConfirmed: false,
    };
    store.applications.push(application);
    await writeStore(store);
    res.status(201).json(application);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to apply' });
  }
});

export default router;
