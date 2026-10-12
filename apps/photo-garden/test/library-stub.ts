// Stands in for p5, imported by URL (see vitest.config.ts). The app touches it only when the Studio
// mounts, which these tests never do.
export default class p5 {
  static disableFriendlyErrors = false;
}
