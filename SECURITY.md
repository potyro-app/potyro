# Security

Potyro runs apps that other people wrote. Keeping them in their box is the point of the project, so
a hole there is the bug we most want to hear about. How the box works, and what it does not
protect, is in [docs/31-security-model.md](docs/31-security-model.md).

## How to report

Report privately, never in a public issue or pull request:

- **GitHub private vulnerability reporting**: on this repository's GitHub page, the **Security** tab,
  then **Report a vulnerability**. This is the preferred way.
- **Email**: security@potyro.com.

Say what you found, the steps or a page that shows it, the browser or device, and the commit or the
site (potyro.app, potyro.com) you tested. A short report is fine; we will ask for what is missing.

## What happens next

- We acknowledge a report within **7 days**.
- We tell you whether we can reproduce it, and keep you told while we fix it.
- We publish a fix and an advisory, and credit you by the name you choose, unless you prefer not.
  Please give us a reasonable time to ship the fix before you publish.

Potyro is maintained by one person. There is **no bug bounty** and no payment for reports.

## In scope

- **The browser realm** that runs shared apps: anything that lets a sealed app's code, or a sealed
  custom view, run outside its sandboxed frame and Worker, reach the network, the shell's page, its
  storage or another app's data, or keep running after the watchdog should have stopped it.
  `packages/host/src/realm/`.
- **`ctx` mediation**: a sealed app using a capability it did not declare or was not granted,
  getting past a permission prompt, or reading or writing another app's records, files or storage.
  `packages/host/src/mediate.ts`, `make-ctx.ts`, `values-gate.ts`.
- **The QuickJS fallback** while it ships (`packages/host/src/isolate/`), on the same terms.
- **Trust and install**: a link, an update or a shared package that makes an app run as trusted
  without the person confirming it (`docs/07-execution-and-targets.md`).
- **The relays and services we run**: the sync relay's deployment (`docs/16-deployment.md`), the AI
  relay (`packages/ai-relay`), the rooms relay (`packages/rooms`), the share-link service
  (`packages/share-links`) and the requests service (`packages/platform-requests`). For example:
  reading another person's data, spending the AI allowance outside its limits, or taking a service
  down with little effort.
- **Identity and keys**: the seed, the vault (`packages/identity`) and the sync encryption.
- **The hosted sites**, potyro.app and potyro.com, for the code in this repository and its
  configuration.

## Out of scope

- Apps you run as your own. A trusted app runs with your full authority on purpose; code you chose
  to trust doing what code can do is not a vulnerability.
- The limits written down in `docs/31-security-model.md` (for example, the sync operator seeing who
  shares a space with whom), unless you find they are worse than stated.
- Denial of service by heavy traffic, spam, and reports from automated scanners with no working
  example.
- Social engineering, and attacks that need a compromised device or browser.
- Bugs in third-party dependencies that do not affect Potyro; report those upstream.
