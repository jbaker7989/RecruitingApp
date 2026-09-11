import { Applicant, JobPosting, Application, EducationEntry, EmploymentEntry, HireRecord, Company } from '../models/store.js';
import { generateId, now, addObservabilityEntry } from '../models/store.js';

// Email regex validation
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

// Match score calculation
export function calculateMatchScore(
  applicant: Applicant,
  job: JobPosting
): {
  matchScore: number;
  keywordMatches: object[];
  educationMatchScore: number;
  experienceMatchScore: number;
} {
  const keywords = job.requirements.map(r => r.toLowerCase());
  const requiredSkills = job.requiredSkills.map(s => s.toLowerCase());
  const allKeywords = [...keywords, ...requiredSkills];

  // Keyword matching against employment history and education
  const applicantText = [
    ...applicant.employmentHistory.map(e => `${e.position} ${e.responsibilities?.join(' ') || ''}`),
    ...applicant.educationHistory.map(e => `${e.fieldOfStudy} ${e.degree}`),
  ].join(' ').toLowerCase();

  let matchedKeywords = 0;
  const keywordMatchDetails: object[] = [];

  for (const keyword of allKeywords) {
    if (applicantText.includes(keyword.toLowerCase())) {
      matchedKeywords++;
      keywordMatchDetails.push({ keyword, matched: true });
    } else {
      keywordMatchDetails.push({ keyword, matched: false });
    }
  }

  // Keyword match score (0-10)
  const keywordScore = allKeywords.length > 0 
    ? Math.round((matchedKeywords / allKeywords.length) * 10) 
    : 0;

  // Education match score (simplified)
  const educationScore = calculateEducationMatch(applicant, job);

  // Experience match score (simplified)
  const experienceScore = calculateExperienceMatch(applicant, job);

  // Final weighted match score (1-10)
  const finalScore = Math.round(
    (keywordScore * 0.4 + educationScore * 0.3 + experienceScore * 0.3)
  );
  const clampedScore = Math.min(10, Math.max(1, finalScore));

  return {
    matchScore: clampedScore,
    keywordMatches: keywordMatchDetails,
    educationMatchScore: educationScore,
    experienceMatchScore: experienceScore,
  };
}

function calculateEducationMatch(applicant: Applicant, job: JobPosting): number {
  // Simplified: check if applicant has any education history
  if (applicant.educationHistory.length === 0) return 3;
  
  // Check if qualifications mention education
  const hasDegree = job.qualifications.some(q => 
    q.toLowerCase().includes('degree') || q.toLowerCase().includes('bachelor') || 
    q.toLowerCase().includes('master') || q.toLowerCase().includes('phd')
  );
  
  if (hasDegree && applicant.educationHistory.length > 0) return 8;
  if (applicant.educationHistory.length > 0) return 6;
  return 3;
}

function calculateExperienceMatch(applicant: Applicant, job: JobPosting): number {
  const totalYears = applicant.employmentHistory.reduce((sum, emp) => {
    const start = new Date(emp.startDate);
    const end = emp.endDate ? new Date(emp.endDate) : new Date();
    return sum + (end.getFullYear() - start.getFullYear());
  }, 0);

  if (totalYears >= job.requiredExperience) return 10;
  if (totalYears >= job.requiredExperience * 0.75) return 8;
  if (totalYears >= job.requiredExperience * 0.5) return 6;
  if (totalYears >= job.requiredExperience * 0.25) return 4;
  return 2;
}

// Create application with match score
export function createApplication(
  applicantId: string, 
  jobPostingId: string, 
  applicant: Applicant, 
  job: JobPosting
): Application {
  const { matchScore, keywordMatches, educationMatchScore, experienceMatchScore } = calculateMatchScore(applicant, job);
  
  return {
    id: generateId(),
    applicantId,
    jobPostingId,
    status: 'pending',
    matchScore,
    keywordMatches,
    educationMatchScore,
    experienceMatchScore,
    appliedAt: now(),
    updatedAt: now(),
    emailConfirmed: false,
  };
}

// Create hire record
export function createHireRecord(
  applicantId: string,
  companyId: string,
  jobPostingId: string,
  positionTitle: string
): HireRecord {
  return {
    id: generateId(),
    applicantId,
    companyId,
    jobPostingId,
    hireDate: now(),
    positionTitle,
    status: 'active',
    notifiedEmployer: false,
    createdAt: now(),
    updatedAt: now(),
  };
}

// Check if job should auto-close
export function checkJobAutoClose(job: JobPosting): boolean {
  return job.currentApplications >= job.totalOpenings;
}
