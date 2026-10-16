#!/usr/bin/env node
// demo-auth.cjs — Run from repo root with: node demo-auth.cjs
// Supply the locally seeded password through DEMO_PASSWORD.
const http = require('http');
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('Set DEMO_PASSWORD before running the demo');
const BASE = 'http://localhost:3000';
const users = [
  { username: 'demo-applicant', role: 'applicant' },
  { username: 'demo-recruiter', role: 'recruiter' },
  { username: 'demo-hiring-manager', role: 'hiring-manager' },
  { username: 'demo-member-services', role: 'member-services' },
];
const post = (body) => new Promise((res, rej) => {
  const u = new URL('/api/auth/login', BASE);
  const req = http.request({ hostname: u.hostname, port: u.port || 3000, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
  req.on('error', rej);
  req.write(JSON.stringify(body));
  req.end();
});
const get = (token, path) => new Promise((res, rej) => {
  const u = new URL(path, BASE);
  const req = http.request({ hostname: u.hostname, port: u.port || 3000, path: u.pathname, method: 'GET', headers: { Authorization: `Bearer ${token}` } }, (r) => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
  req.on('error', rej);
  req.end();
});
(async () => {
  console.log('=== Auth check: /api/auth/me per role ===\n');
  for (const u of users) {
    const { token } = await post({ username: u.username, password: password });
    const me = await get(token, '/api/auth/me');
    console.log(`${u.role.padEnd(16)} → ${u.username} → role=${me.role} token=${token.slice(0, 30)}...`);
  }
  console.log('\nDone.');
})();
