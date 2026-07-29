import '@testing-library/jest-dom/vitest'

// jsdom has no layout engine, so it never implements scrollIntoView -- calling it (e.g.
// ThreadView's initial-scroll-into-place effect) throws "not a function" without this stub.
// Guarded on `typeof Element` too: some test files run in vitest's plain `node` environment
// (no DOM globals at all), where this file still runs but `Element` doesn't exist.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
