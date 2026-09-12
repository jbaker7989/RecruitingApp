import type {
  Applicant,
  ApplicantAvatar,
  DataStore,
  EducationEntry,
  EmploymentEntry,
  EmploymentType,
  ProfileCompleteness,
  SkillEntry,
  User,
  WorkMode,
} from '../models/store.js';
import { now } from '../models/store.js';

export const DEFAULT_AVATAR: ApplicantAvatar = Object.freeze({
  kind: 'default-person-icon',
  icon: 'person',
  altText: 'Default person profile icon',
});

export const CONTACT_VISIBILITY = Object.freeze({
  email: 'authorized-staff' as const,
  phone: 'post-initial-review' as const,
});

const EMPLOYMENT_TYPES = new Set<EmploymentType>([
  'full-time', 'part-time', 'contract', 'temporary', 'internship', 'volunteer', 'self-employed',
]);
const WORK_MODES = new Set<WorkMode>(['onsite', 'hybrid', 'remote']);
const PROFICIENCIES = new Set(['beginner', 'intermediate', 'advanced', 'expert']);
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;
const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface ValidationResult<T = undefined> {
  valid: boolean;
  errors: string[];
  value?: T;
}

export interface OwnedProfileResolution {
  status: 'found' | 'missing' | 'ambiguous' | 'forbidden';
  profile?: Applicant;
  profileIndex?: number;
  user?: User;
  changed?: boolean;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown, maxItems = 20, maxLength = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value);
}

function normalizeAvatar(value: unknown): ApplicantAvatar {
  const avatar = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (avatar.kind === 'upload' && typeof avatar.url === 'string' && typeof avatar.pathname === 'string') {
    return {
      kind: 'upload',
      icon: 'person',
      altText: cleanString(avatar.altText) || 'Applicant profile photo',
      provider: 'vercel-blob',
      url: avatar.url,
      pathname: avatar.pathname,
      contentType: typeof avatar.contentType === 'string' ? avatar.contentType : undefined,
      size: typeof avatar.size === 'number' ? avatar.size : undefined,
    };
  }
  return { ...DEFAULT_AVATAR };
}

function normalizeSkill(value: unknown): SkillEntry | null {
  if (!value || typeof value !== 'object') return null;
  const skill = value as Record<string, unknown>;
  const name = cleanString(skill.name);
  const proficiency = cleanString(skill.proficiency);
  if (!name || !PROFICIENCIES.has(proficiency)) return null;
  return {
    name: name.slice(0, 100),
    proficiency: proficiency as SkillEntry['proficiency'],
    yearsUsed: typeof skill.yearsUsed === 'number' && skill.yearsUsed >= 0 ? skill.yearsUsed : undefined,
    lastUsed: isValidDate(skill.lastUsed) ? skill.lastUsed : undefined,
  };
}

function normalizeEducation(value: unknown): EducationEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const institution = cleanString(entry.institution);
  const degree = cleanString(entry.degree);
  const fieldOfStudy = cleanString(entry.fieldOfStudy);
  const startDate = cleanString(entry.startDate);
  const endDate = cleanString(entry.endDate);
  if (!institution || !degree || !fieldOfStudy || !startDate || !endDate) return null;
  return {
    institution: institution.slice(0, 150),
    degree: degree.slice(0, 150),
    fieldOfStudy: fieldOfStudy.slice(0, 150),
    startDate,
    endDate,
    gpa: cleanString(entry.gpa) || undefined,
  };
}

export function validateEmploymentEntry(value: unknown): ValidationResult<EmploymentEntry> {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['employment entry must be an object'] };
  }
  const entry = value as Record<string, unknown>;
  const allowed = new Set([
    'id', 'company', 'position', 'positionDescription', 'startDate', 'endDate', 'currentPosition',
    'responsibilities', 'accomplishments', 'skills', 'employmentType', 'location', 'workMode',
  ]);
  const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
  if (unknown.length) errors.push(`Unknown employment fields: ${unknown.join(', ')}`);

  const company = cleanString(entry.company);
  const position = cleanString(entry.position);
  const positionDescription = cleanString(entry.positionDescription);
  const startDate = cleanString(entry.startDate);
  const endDate = cleanString(entry.endDate);
  const currentPosition = entry.currentPosition === true;

  if (!company || company.length > 150) errors.push('company is required and must be <= 150 characters');
  if (!position || position.length > 150) errors.push('position is required and must be <= 150 characters');
  if (positionDescription.length < 50 || positionDescription.length > 2000) {
    errors.push('positionDescription must be between 50 and 2000 characters');
  }
  if (!isValidDate(startDate)) errors.push('startDate must use YYYY-MM or YYYY-MM-DD');
  if (currentPosition && endDate) errors.push('endDate must be omitted for a current position');
  if (!currentPosition && !isValidDate(endDate)) errors.push('endDate is required and must use YYYY-MM or YYYY-MM-DD');
  if (isValidDate(startDate) && isValidDate(endDate) && startDate.slice(0, 7) > endDate.slice(0, 7)) {
    errors.push('endDate cannot be before startDate');
  }
  if (entry.employmentType !== undefined && !EMPLOYMENT_TYPES.has(entry.employmentType as EmploymentType)) {
    errors.push('Invalid employmentType');
  }
  if (entry.workMode !== undefined && !WORK_MODES.has(entry.workMode as WorkMode)) errors.push('Invalid workMode');
  for (const key of ['responsibilities', 'accomplishments', 'skills'] as const) {
    if (entry[key] !== undefined && (!Array.isArray(entry[key]) || (entry[key] as unknown[]).some((item) => typeof item !== 'string'))) {
      errors.push(`${key} must be an array of strings`);
    }
  }

  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    value: {
      id: cleanString(entry.id) || crypto.randomUUID(),
      company,
      position,
      positionDescription,
      startDate,
      endDate: currentPosition ? undefined : endDate,
      currentPosition,
      responsibilities: stringArray(entry.responsibilities),
      accomplishments: stringArray(entry.accomplishments),
      skills: stringArray(entry.skills, 30, 100),
      employmentType: entry.employmentType as EmploymentType | undefined,
      location: cleanString(entry.location).slice(0, 150) || undefined,
      workMode: entry.workMode as WorkMode | undefined,
    },
  };
}

function employmentIsComplete(entry: EmploymentEntry): boolean {
  return validateEmploymentEntry(entry).valid;
}

export function calculateCompleteness(applicant: Applicant): ProfileCompleteness {
  const sections: Record<string, boolean> = {
    identity: Boolean(cleanString(applicant.firstName) && cleanString(applicant.lastName)),
    contact: Boolean(EMAIL_PATTERN.test(cleanString(applicant.email)) && PHONE_PATTERN.test(cleanString(applicant.phone))),
    location: Boolean(cleanString(applicant.address?.state) && ZIP_PATTERN.test(cleanString(applicant.address?.zip)) && applicant.address?.country === 'US'),
    workAuthorization: typeof applicant.rightToWork === 'boolean' && typeof applicant.requiresSponsorship === 'boolean',
    professionalSummary: Boolean(cleanString(applicant.headline) && cleanString(applicant.professionalSummary)),
    employmentHistory: Boolean(applicant.employmentHistory?.length && applicant.employmentHistory.every(employmentIsComplete)),
    educationHistory: Boolean(applicant.educationHistory?.length),
    skills: Boolean(applicant.skills?.length),
  };
  const missingSections = Object.entries(sections).filter(([, complete]) => !complete).map(([name]) => name);
  return {
    percent: Math.round(((Object.keys(sections).length - missingSections.length) / Object.keys(sections).length) * 100),
    missingSections,
  };
}

export function normalizeApplicantProfile(applicant: Applicant): Applicant {
  const normalizedEmployment = (Array.isArray(applicant.employmentHistory) ? applicant.employmentHistory : []).map((entry) => {
    const valid = validateEmploymentEntry(entry);
    if (valid.valid && valid.value) return valid.value;
    return {
      id: entry.id || crypto.randomUUID(),
      company: cleanString(entry.company),
      position: cleanString(entry.position),
      positionDescription: cleanString(entry.positionDescription),
      startDate: cleanString(entry.startDate),
      endDate: cleanString(entry.endDate) || undefined,
      currentPosition: entry.currentPosition ?? !entry.endDate,
      responsibilities: stringArray(entry.responsibilities),
      accomplishments: stringArray(entry.accomplishments),
      skills: stringArray(entry.skills, 30, 100),
      employmentType: EMPLOYMENT_TYPES.has(entry.employmentType as EmploymentType) ? entry.employmentType : undefined,
      location: cleanString(entry.location) || undefined,
      workMode: WORK_MODES.has(entry.workMode as WorkMode) ? entry.workMode : undefined,
    } as EmploymentEntry;
  });

  const normalized: Applicant = {
    ...applicant,
    userId: applicant.userId ?? null,
    profileVersion: Number.isInteger(applicant.profileVersion) && (applicant.profileVersion || 0) > 0 ? applicant.profileVersion : 1,
    profileStatus: applicant.profileStatus || 'draft',
    preferredName: cleanString(applicant.preferredName) || undefined,
    pronouns: cleanString(applicant.pronouns) || undefined,
    headline: cleanString(applicant.headline) || undefined,
    professionalSummary: cleanString(applicant.professionalSummary) || undefined,
    contactVisibility: { ...CONTACT_VISIBILITY },
    avatar: normalizeAvatar(applicant.avatar),
    address: {
      city: cleanString(applicant.address?.city) || undefined,
      state: cleanString(applicant.address?.state),
      zip: cleanString(applicant.address?.zip),
      country: 'US',
    },
    educationHistory: (Array.isArray(applicant.educationHistory) ? applicant.educationHistory : [])
      .map(normalizeEducation).filter((entry): entry is EducationEntry => entry !== null),
    employmentHistory: normalizedEmployment,
    skills: (Array.isArray(applicant.skills) ? applicant.skills : [])
      .map(normalizeSkill).filter((skill): skill is SkillEntry => skill !== null),
    hireRecords: Array.isArray(applicant.hireRecords) ? applicant.hireRecords : [],
  };
  normalized.completeness = calculateCompleteness(normalized);
  normalized.profileStatus = normalized.completeness.percent === 100 ? 'complete' : 'draft';
  return normalized;
}

export function validateProfileCreation(body: unknown, user: User): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { valid: false, errors: ['body must be an object'] };
  const data = body as Record<string, unknown>;
  const allowed = new Set([
    'firstName', 'lastName', 'email', 'emailConfirmation', 'phone', 'preferredContactMethod',
    'address', 'rightToWork', 'requiresSponsorship', 'preferredName', 'pronouns', 'headline', 'professionalSummary',
  ]);
  const unknown = Object.keys(data).filter((key) => !allowed.has(key));
  if (unknown.length) errors.push(`Unknown profile fields: ${unknown.join(', ')}`);

  const firstName = cleanString(data.firstName);
  const lastName = cleanString(data.lastName);
  const email = cleanString(data.email).toLowerCase();
  const emailConfirmation = cleanString(data.emailConfirmation).toLowerCase();
  const phone = cleanString(data.phone);
  const address = data.address && typeof data.address === 'object' ? data.address as Record<string, unknown> : {};
  if (!firstName || firstName.length > 100) errors.push('firstName is required and must be <= 100 characters');
  if (!lastName || lastName.length > 100) errors.push('lastName is required and must be <= 100 characters');
  if (!EMAIL_PATTERN.test(email)) errors.push('Valid email is required');
  if (email !== emailConfirmation) errors.push('emailConfirmation must match email');
  if (email !== user.email.trim().toLowerCase()) errors.push('Profile email must match the authenticated account');
  if (!PHONE_PATTERN.test(phone)) errors.push('Valid phone is required');
  if (data.preferredContactMethod !== 'email' && data.preferredContactMethod !== 'sms') errors.push('preferredContactMethod must be email or sms');
  if (!/^[A-Za-z]{2}$/.test(cleanString(address.state))) errors.push('address.state must be a two-letter US state code');
  if (!ZIP_PATTERN.test(cleanString(address.zip))) errors.push('address.zip must be a valid US ZIP code');
  if (address.country !== 'US') errors.push('address.country must be US');
  if (typeof data.rightToWork !== 'boolean') errors.push('rightToWork must be boolean');
  if (typeof data.requiresSponsorship !== 'boolean') errors.push('requiresSponsorship must be boolean');
  return { valid: errors.length === 0, errors };
}

const PROFILE_PATCH_FIELDS = new Set([
  'preferredName', 'pronouns', 'headline', 'professionalSummary', 'phone', 'preferredContactMethod',
  'address', 'rightToWork', 'requiresSponsorship', 'expectedPay', 'educationHistory', 'skills',
]);

export function applyProfilePatch(applicant: Applicant, body: unknown): ValidationResult<Applicant> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { valid: false, errors: ['body must be an object'] };
  const data = body as Record<string, unknown>;
  const unknown = Object.keys(data).filter((key) => !PROFILE_PATCH_FIELDS.has(key));
  if (!Object.keys(data).length) return { valid: false, errors: ['At least one profile field is required'] };
  if (unknown.length) return { valid: false, errors: [`Protected or unknown profile fields: ${unknown.join(', ')}`] };
  const errors: string[] = [];
  const next: Applicant = { ...applicant };

  for (const field of ['preferredName', 'pronouns', 'headline', 'professionalSummary'] as const) {
    if (field in data) {
      if (typeof data[field] !== 'string') errors.push(`${field} must be a string`);
      else {
        const max = field === 'professionalSummary' ? 2000 : 150;
        if ((data[field] as string).trim().length > max) errors.push(`${field} must be <= ${max} characters`);
        else next[field] = (data[field] as string).trim() || undefined;
      }
    }
  }
  if ('phone' in data) {
    const phone = cleanString(data.phone);
    if (!PHONE_PATTERN.test(phone)) errors.push('Invalid phone'); else next.phone = phone;
  }
  if ('preferredContactMethod' in data) {
    if (data.preferredContactMethod !== 'email' && data.preferredContactMethod !== 'sms') errors.push('preferredContactMethod must be email or sms');
    else next.preferredContactMethod = data.preferredContactMethod;
  }
  if ('address' in data) {
    const address = data.address && typeof data.address === 'object' ? data.address as Record<string, unknown> : {};
    if (!/^[A-Za-z]{2}$/.test(cleanString(address.state)) || !ZIP_PATTERN.test(cleanString(address.zip)) || address.country !== 'US') {
      errors.push('address requires two-letter state, valid US ZIP, and country US');
    } else next.address = { city: cleanString(address.city) || undefined, state: cleanString(address.state).toUpperCase(), zip: cleanString(address.zip), country: 'US' };
  }
  for (const field of ['rightToWork', 'requiresSponsorship'] as const) {
    if (field in data) {
      if (typeof data[field] !== 'boolean') errors.push(`${field} must be boolean`);
      else next[field] = data[field] as boolean;
    }
  }
  if ('expectedPay' in data) {
    if (typeof data.expectedPay !== 'number' || !Number.isFinite(data.expectedPay) || data.expectedPay < 0) errors.push('expectedPay must be a non-negative number');
    else next.expectedPay = data.expectedPay;
  }
  if ('educationHistory' in data) {
    if (!Array.isArray(data.educationHistory)) errors.push('educationHistory must be an array');
    else {
      const education = data.educationHistory.map(normalizeEducation);
      if (education.some((entry) => entry === null)) errors.push('Each education entry requires institution, degree, fieldOfStudy, startDate, and endDate');
      else next.educationHistory = education as EducationEntry[];
    }
  }
  if ('skills' in data) {
    if (!Array.isArray(data.skills)) errors.push('skills must be an array');
    else {
      const skills = data.skills.map(normalizeSkill);
      if (skills.some((entry) => entry === null)) errors.push('Each skill requires name and valid proficiency');
      else next.skills = skills as SkillEntry[];
    }
  }
  if (errors.length) return { valid: false, errors };

  next.profileVersion = (applicant.profileVersion || 1) + 1;
  next.updatedAt = now();
  return { valid: true, errors: [], value: normalizeApplicantProfile(next) };
}

export function createApplicantProfile(body: Record<string, unknown>, user: User): Applicant {
  const timestamp = now();
  const personId = user.personId || crypto.randomUUID();
  user.personId = personId;
  const applicant: Applicant = {
    id: crypto.randomUUID(),
    userId: user.id,
    personId,
    profileVersion: 1,
    profileStatus: 'draft',
    firstName: cleanString(body.firstName),
    lastName: cleanString(body.lastName),
    preferredName: cleanString(body.preferredName) || undefined,
    pronouns: cleanString(body.pronouns) || undefined,
    headline: cleanString(body.headline) || undefined,
    professionalSummary: cleanString(body.professionalSummary) || undefined,
    email: cleanString(body.email).toLowerCase(),
    phone: cleanString(body.phone),
    preferredContactMethod: body.preferredContactMethod as 'email' | 'sms',
    contactVisibility: { ...CONTACT_VISIBILITY },
    avatar: { ...DEFAULT_AVATAR },
    address: {
      city: cleanString((body.address as Record<string, unknown>)?.city) || undefined,
      state: cleanString((body.address as Record<string, unknown>).state).toUpperCase(),
      zip: cleanString((body.address as Record<string, unknown>).zip),
      country: 'US',
    },
    educationHistory: [],
    employmentHistory: [],
    skills: [],
    rightToWork: body.rightToWork as boolean,
    requiresSponsorship: body.requiresSponsorship as boolean,
    expectedPay: 0,
    notificationToManager: false,
    hireRecords: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const normalized = normalizeApplicantProfile(applicant);
  user.applicantId = normalized.id;
  return normalized;
}

export function resolveOwnedProfile(store: DataStore, userId: string): OwnedProfileResolution {
  const user = store.users.find((item) => item.id === userId);
  if (!user || user.role !== 'applicant') return { status: 'forbidden' };

  let index = user.applicantId ? store.applicants.findIndex((item) => item.id === user.applicantId) : -1;
  if (index === -1) index = store.applicants.findIndex((item) => item.userId === user.id);
  if (index === -1) {
    const email = user.email.trim().toLowerCase();
    const candidates = store.applicants
      .map((item, candidateIndex) => ({ item, candidateIndex }))
      .filter(({ item }) => !item.userId && item.email.trim().toLowerCase() === email);
    if (candidates.length > 1) return { status: 'ambiguous', user };
    if (candidates.length === 0) return { status: 'missing', user };
    index = candidates[0].candidateIndex;
  }

  const beforeProfile = JSON.stringify(store.applicants[index]);
  const beforeUser = JSON.stringify(user);
  const personId = user.personId || store.applicants[index].personId || crypto.randomUUID();
  user.personId = personId;
  user.applicantId = store.applicants[index].id;
  store.applicants[index] = normalizeApplicantProfile({
    ...store.applicants[index],
    userId: user.id,
    personId,
  });
  return {
    status: 'found',
    profile: store.applicants[index],
    profileIndex: index,
    user,
    changed: beforeProfile !== JSON.stringify(store.applicants[index]) || beforeUser !== JSON.stringify(user),
  };
}
