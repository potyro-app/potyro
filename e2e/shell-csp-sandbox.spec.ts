import { shellCspTests } from "./shell-csp.js";

// The shell's frame-src policy on the dev server (#272). The same checks run against a production
// build in shell-csp-prod.spec.ts.
shellCspTests();
