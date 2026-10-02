// Loaded via bunfig.toml `preload` before any test file. Registers a happy-dom
// global environment and extends bun:test `expect` with jest-dom matchers so
// component tests can assert on rendered DOM (`toBeInTheDocument`, etc.).

// Turn OFF RTL's automatic `afterEach(cleanup)`, before anything can import RTL.
//
// This must be first, and it is the other half of the teardown decision below.
// Importing `@testing-library/react` anywhere in a test file registers a global
// `afterEach(cleanup)` as a side effect of the import, so the file below was only
// half a policy: the innerHTML wipe ran, AND RTL's own cleanup ran, in an order
// that depends on hook registration. Whichever ran second found a container that
// had already been detached and threw
//
//     DOMException: Failed to execute 'removeChild' on 'Node':
//     The node to be removed is not a child of this node.
//
// — which is precisely the failure the innerHTML wipe exists to avoid. It only
// showed up when several component test files ran in one process, so a file
// could be green alone and red in the full suite, and the red ones looked like
// they had failed assertions when no assertion had even been reached.
import "@testing-library/react/dont-cleanup-after-each";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, expect } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost:5173" });

expect.extend(jestDomMatchers as Parameters<typeof expect.extend>[0]);

// Reset the document between tests so portals (toasts, dialogs) don't leak.
// We deliberately don't use RTL's `cleanup()` here — its unmount path triggers
// removeChild on portal nodes that happy-dom's tree no longer owns, throwing
// DOMException. Wiping innerHTML keeps happy-dom and React in sync.
//
// `body.style.overflow` is also reset because Dialog + focus-mode primitives
// set it to "hidden" when open and rely on their own teardown effects to
// clear it. If a test unmounts mid-effect (which happy-dom often does), the
// "hidden" lingers and poisons whichever test runs next.
afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});
