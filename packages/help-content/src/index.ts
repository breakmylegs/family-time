// The help panel's content and the helpers to read it. The topics themselves are bundled at build
// into `@family-time/help-content/content`, so the parent app works offline and a (?) button
// naming a topic that does not exist fails the app's typecheck.
export * from './types.js';
export { forChild } from './render.js';
export { checkContent, type Problems } from './check.js';
export { parseSources, parseTopic, ContentError } from './parse.js';
