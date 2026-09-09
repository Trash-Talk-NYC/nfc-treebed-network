// Which adapter this bundle was built for, available at runtime.
//
// astro.config.mjs picks the adapter from TREEBED_ADAPTER and defines this
// identifier alongside it, so code that has to behave differently on the two
// targets asks the build rather than sniffing the environment: a platform
// rename or a missing variable can then never silently downgrade a deploy to
// the node target's assumptions. Undefined outside an Astro/Vite build (the
// unit suites), where `node` is the truthful answer.

export type BuildTarget = 'node' | 'netlify';

declare const __TREEBED_BUILD_TARGET__: BuildTarget;

export const BUILD_TARGET: BuildTarget =
  typeof __TREEBED_BUILD_TARGET__ === 'string' ? __TREEBED_BUILD_TARGET__ : 'node';
