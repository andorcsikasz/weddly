// Teach `bun:test` about the jest-dom matchers we register in tests/setup.ts.
// Without this, TS doesn't know `expect(node).toBeInTheDocument()` exists even
// though it runs fine.

import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<unknown, unknown> {}
}
