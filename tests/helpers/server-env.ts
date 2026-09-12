// The environment every e2e server is spawned with.
//
// The suites inherit `process.env` so a developer's Node and PATH carry over,
// which also inherits whatever mail configuration their shell exports. The
// captain's instruction is "do not send anything": with the org's real
// BREVO_API_KEY exported, `sendMail` would take the live Brevo path instead
// of the dev outbox the suites read their links out of — a real send attempt,
// and a suite that then fails on an empty outbox. So the three mail keys are
// stripped here rather than in each spawn site, and the outbox transport is
// structural instead of incidental.
const MAIL_KEYS = ['BREVO_API_KEY', 'TREEBED_MAIL_FROM', 'TREEBED_PUBLIC_ORIGIN'] as const;

/** `process.env` with the mail plane disarmed, plus whatever the suite sets. */
export function serverEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of MAIL_KEYS) delete env[key];
  return { ...env, ...overrides };
}
