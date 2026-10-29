// Deployment preflight (NFR-056). Fails the build when production auth secrets are
// missing or weak, instead of letting the function 500 on cold start.
// Usage: npm run preflight   (run after `npm run build`; enforced only when NODE_ENV=production)
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

if (process.env.NODE_ENV !== 'production') {
  console.log('preflight=skipped (NODE_ENV is not production)');
  process.exit(0);
}

const { authSecretProblems } = await import(pathToFileURL(resolve('dist/config/authSecrets.js')).href);
const problems = authSecretProblems();
if (problems.length) {
  console.error('preflight=failed');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log('preflight=ok');
