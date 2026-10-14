import { shellCspTests } from "./shell-csp.js";

// The shell's frame-src policy in a production build served by `vite preview` (#272): the header and
// the <meta> that the Capacitor WebView relies on. `pnpm test:e2e:prod`.
shellCspTests();
