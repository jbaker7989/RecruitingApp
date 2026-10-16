const http = require('http');
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('Set DEMO_PASSWORD before running the demo');
const post = (body) => new Promise((res, rej) => {
  const r = http.request({ hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (x) => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(JSON.parse(d))); });
  r.on('error', rej); r.write(JSON.stringify(body)); r.end();
});
const get = (token, path) => new Promise((res, rej) => {
  const r = http.request({ hostname: 'localhost', port: 3000, path, method: 'GET', headers: { Authorization: 'Bearer ' + token } }, (x) => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch(e) { res(d); } }); });
  r.on('error', rej); r.end();
});
const del = (token, path) => new Promise((res, rej) => {
  const r = http.request({ hostname: 'localhost', port: 3000, path, method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }, (x) => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch(e) { res(d); } }); });
  r.on('error', rej); r.end();
});
const postx = (token, path, body) => new Promise((res, rej) => {
  const u = new URL(path, 'http://localhost:3000');
  const r = http.request({ hostname: u.hostname, port: u.port || 3000, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } }, (x) => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch(e) { res(d); } }); });
  r.on('error', rej); r.write(JSON.stringify(body)); r.end();
});
(async () => {
  const { token: a } = await post({ username: 'demo-applicant', password: password });
  const { token: r } = await post({ username: 'demo-recruiter', password: password });
  const { token: h } = await post({ username: 'demo-hiring-manager', password: password });
  const { token: m } = await post({ username: 'demo-member-services', password: password });
  console.log('=== RBAC DEMO (global auth + requireRole on route) ===\n');
  console.log('1. GET /api/jobs (recruiter+) — applicant:');
  console.log('   →', JSON.stringify(await get(a, '/api/jobs')));
  console.log('   GET /api/jobs — hiring-manager:');
  console.log('   →', JSON.stringify(await get(h, '/api/jobs')));
  console.log('\n2. GET /api/companies (recruiter+) — applicant:');
  console.log('   →', JSON.stringify(await get(a, '/api/companies')));
  console.log('   GET /api/companies — member-services:');
  console.log('   →', JSON.stringify(await get(m, '/api/companies')));
  console.log('\n3. POST /api/companies (hiring-manager+) — applicant:');
  console.log('   →', JSON.stringify(await postx(a, '/api/companies', { companyName: 'X', description: 'D', location: 'S' })));
  console.log('   POST /api/companies — member-services:');
  console.log('   →', JSON.stringify(await postx(m, '/api/companies', { companyName: 'Demo Co', description: 'D', location: 'S', companySize: '10', industry: 't' })));
  console.log('\n4. DELETE /api/companies/:id (member-services only) — recruiter:');
  console.log('   →', JSON.stringify(await del(r, '/api/companies/u1')));
  console.log('   DELETE /api/companies/u1 — member-services:');
  console.log('   →', JSON.stringify(await del(m, '/api/companies/u1')));
})();
