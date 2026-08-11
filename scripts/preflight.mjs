// Boot gate for `npm start` and `npm run preview` (npm runs it as prestart
// and prepreview).
//
// The same requirement `getSecret()` enforces in src/lib/session.ts, checked
// before the server binds a port: a missing secret should stop the deploy,
// not wait to be discovered by traffic. `astro preview` serves the production
// build, so it is under the same requirement and gets the same one-line
// explanation instead of a stack trace. Servers started some other way still
// hit the assertion in src/middleware.ts on their first request.
if (!process.env.TREEBED_SESSION_SECRET) {
  console.error(
    'TREEBED_SESSION_SECRET must be set to start the server — refusing to sign cookies with a generated secret.',
  );
  process.exit(1);
}
