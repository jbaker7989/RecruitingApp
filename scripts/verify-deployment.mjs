// Post-deploy gate (NFR-071): a Vercel build can succeed while the function
// crashes at module load, so the deployed URL itself must answer /health.
const baseUrl = (process.env.DEPLOYMENT_URL ?? process.argv[2] ?? '').replace(/\/+$/, '');
if (!baseUrl) {
  console.error('usage: DEPLOYMENT_URL=https://<deployment> npm run verify:deploy');
  process.exit(2);
}

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const headers = bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {};
const healthUrl = `${baseUrl}/health`;

let lastFailure = '';
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    const response = await fetch(healthUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    if (response.status === 200) {
      let payload;
      try { payload = JSON.parse(body); } catch { payload = undefined; }
      if (payload?.status === 'ok') {
        console.log(`deploy-health=ok ${healthUrl}`);
        process.exit(0);
      }
      lastFailure = `200 with unexpected body: ${body.slice(0, 200)}`;
    } else if ([401, 403, 302, 303, 307, 308].includes(response.status)) {
      // NFR-074: unreachable is not healthy. Never follow a redirect with the
      // bypass header; it could send the secret to a different origin.
      lastFailure = `HTTP ${response.status}: health is not verified; configure a valid VERCEL_AUTOMATION_BYPASS_SECRET for protected previews`;
      break;
    } else {
      lastFailure = `HTTP ${response.status}: ${body.slice(0, 200)}`;
    }
  } catch (error) {
    lastFailure = String(error);
  }
  if (attempt < 5) await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
}

console.error(`deploy-health=failed ${healthUrl}\n${lastFailure}`);
process.exit(1);
