/**
 * NFR-042: README priority order must match BUGS.md, its declared source of truth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readme = readFileSync('README.md', 'utf8');
const section = readme.split('## Current release blockers and next decisions')[1]?.split('\n---')[0] || '';

test('NFR-042: README preserves the source-of-truth dependency order for auth and media', () => {
  const nfr008 = section.indexOf('**NFR-008');
  const media = section.indexOf('**NFR-038');
  const nfr003 = section.indexOf('**NFR-003');
  assert.ok(nfr008 >= 0 && media >= 0 && nfr003 >= 0, 'required priority groups must be present');
  assert.ok(nfr008 < media, 'NFR-008 must precede applicant media hardening');
  assert.ok(media < nfr003, 'applicant media group must precede NFR-003 per BUGS.md');
});

test('NFR-042: README includes every remaining active BUGS.md priority group before feature continuation', () => {
  assert.match(section, /\*\*NFR-007, NFR-005, NFR-006/);
  assert.match(section, /\*\*NFR-009–013/);
  assert.match(section, /\*\*NFR-014–019/);
  const queueEnd = section.indexOf('Continue NFR-FEAT-001');
  for (const group of ['**NFR-007, NFR-005, NFR-006', '**NFR-009–013', '**NFR-014–019']) {
    assert.ok(section.indexOf(group) < queueEnd, `${group} must precede feature continuation`);
  }
});
