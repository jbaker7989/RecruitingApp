// Local demo setup. Run with DEMO_PASSWORD set; preserves other applicants/users.
const fs = require('fs');
const bcrypt = require('bcryptjs');
const path = require('path');
if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production');
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12) throw new Error('Set DEMO_PASSWORD to at least 12 characters');
const storePath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'store.json');
const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
const passwordHash = bcrypt.hashSync(password, 10);
const timestamp = new Date().toISOString();
store.users ??= [];
for (const [index, role] of ['applicant', 'recruiter', 'hiring-manager', 'member-services'].entries()) {
  const username = `demo-${role}`;
  const existing = store.users.find(user => user.username === username);
  if (existing) existing.passwordHash = passwordHash;
  else store.users.push({ id: `demo-user-${index + 1}`, username, role, email: `${role}@demo.local`, passwordHash, createdAt: timestamp });
}
store.applicants ??= [];
const existing = store.applicants.find(applicant => applicant.email === 'applicant@demo.local');
if (existing) { existing.passwordHash = passwordHash; existing.updatedAt = timestamp; }
else store.applicants.push({
  id: 'demo-applicant', firstName: 'Demo', lastName: 'Applicant', email: 'applicant@demo.local',
  passwordHash, phone: '', preferredContactMethod: 'email',
  address: { state: '', zip: '' }, educationHistory: [], employmentHistory: [],
  rightToWork: false, requiresSponsorship: false, expectedPay: 0,
  notificationToManager: false, hireRecords: [], oauthProvider: null, oauthProviderId: null,
  createdAt: timestamp, updatedAt: timestamp,
});
fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n');
console.log('Local demo accounts ready; use the password supplied through DEMO_PASSWORD.');
