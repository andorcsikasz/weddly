// Loaded via bunfig.toml `preload` before any test file. Registers a happy-dom
// global environment and extends bun:test `expect` with jest-dom matchers so
// component tests can assert on rendered DOM (`toBeInTheDocument`, etc.).

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, expect } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost:5173" });

expect.extend(jestDomMatchers as Parameters<typeof expect.extend>[0]);

// Keep DOM hermetic across tests so rendered nodes don't leak.
afterEach(() => {
  document.body.innerHTML = "";
});
