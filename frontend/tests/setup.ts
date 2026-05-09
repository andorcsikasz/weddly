// Loaded via bunfig.toml `preload` before any test file. Registers a happy-dom
// global environment and extends bun:test `expect` with jest-dom matchers so
// component tests can assert on rendered DOM (`toBeInTheDocument`, etc.).

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, expect } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost:5173" });

expect.extend(jestDomMatchers as Parameters<typeof expect.extend>[0]);

// Reset the document between tests so portals (toasts, dialogs) don't leak.
// We deliberately don't use RTL's `cleanup()` here — its unmount path triggers
// removeChild on portal nodes that happy-dom's tree no longer owns, throwing
// DOMException. Wiping innerHTML keeps happy-dom and React in sync.
afterEach(() => {
  document.body.innerHTML = "";
});
