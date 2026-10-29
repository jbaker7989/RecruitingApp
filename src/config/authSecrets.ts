/**
 * Auth secret policy (NFR-056). One definition shared by the token service
 * (fail-closed at module load) and scripts/preflight.mjs (fail at build/deploy
 * time, before a cold start would 500). Never includes secret values in output.
 */
export const DEV_USER_SECRET = 'dev-user-jwt-secret-change-in-production';
export const DEV_APPLICANT_SECRET = 'dev-applicant-jwt-secret-change-in-production';
export const MIN_SECRET_LENGTH = 32;

export const AUTH_SECRETS = [
  { envVar: 'JWT_SECRET', devDefault: DEV_USER_SECRET },
  { envVar: 'APPLICANT_JWT_SECRET', devDefault: DEV_APPLICANT_SECRET },
] as const;

/** Returns a description of what is wrong with the secret, or null if it is acceptable. */
export function secretProblem(envVar: string, devDefault: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[envVar];
  if (!value) {
    return `${envVar} is required. Set it in production to a strong secret (>= ${MIN_SECRET_LENGTH} chars).`;
  }
  if (value === devDefault) {
    return `${envVar} is set to the dev default secret. Set a strong, unique secret in production.`;
  }
  if (value.length < MIN_SECRET_LENGTH) {
    return `${envVar} is too short (${value.length} chars). Use at least ${MIN_SECRET_LENGTH} characters in production.`;
  }
  return null;
}

/** All production auth-secret problems; empty when the environment is deployable. */
export function authSecretProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  for (const { envVar, devDefault } of AUTH_SECRETS) {
    const problem = secretProblem(envVar, devDefault, env);
    if (problem) problems.push(problem);
  }
  if (!problems.length && env.JWT_SECRET === env.APPLICANT_JWT_SECRET) {
    problems.push('JWT_SECRET and APPLICANT_JWT_SECRET must differ so staff and applicant tokens cannot be interchanged.');
  }
  return problems;
}
