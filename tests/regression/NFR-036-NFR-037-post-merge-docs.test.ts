/**
 * Post-merge review findings for PR #1 documentation consistency.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bugs = readFileSync('BUGS.md', 'utf8');

function between(start: RegExp, end: RegExp): string {
  const startMatch = bugs.match(start);
  assert.ok(startMatch?.index !== undefined, `missing section ${start}`);
  const rest = bugs.slice(startMatch.index + startMatch[0].length);
  const endMatch = rest.match(end);
  return endMatch?.index === undefined ? rest : rest.slice(0, endMatch.index);
}

test('NFR-036: NFR-030 has a dated resolution block consistent with resolved critical entries', () => {
  const section = between(/^30\. \[NFR-030\].*$/m, /^31\. \[NFR-031\]/m);
  assert.match(section, /> \*\*✅ RESOLUTION — \d{4}-\d{2}-\d{2}/);
  assert.match(section, /branch `[^`]+`.*PR #\d+/);
});

test('NFR-036: NFR-030 resolution records root cause and Red-to-Green evidence', () => {
  const section = between(/^30\. \[NFR-030\].*$/m, /^31\. \[NFR-031\]/m);
  assert.match(section, /\*\*Root cause:\*\*/i);
  assert.match(section, /\*\*Red.*Green.*:\*\*/i);
  assert.match(section, /RESOLUTON-OF-ISSUE-NFR-030\.docx/);
});

test('NFR-037: active suggested fix order does not instruct maintainers to merge completed PR #1', () => {
  const queue = between(/^## Suggested fix order.*$/m, /^Resolved and removed/m);
  assert.doesNotMatch(queue, /merge PR #1/i);
});

test('NFR-037: resolved NFR-001, NFR-030, and NFR-033 are absent from the active queue', () => {
  const queue = between(/^## Suggested fix order.*$/m, /^Resolved and removed/m);
  assert.doesNotMatch(queue, /NFR-(?:001|030|033)/);
});
