// Stands in for a library imported by URL (see vitest.config.ts). The app touches it only when its
// chart view mounts, which these tests never do.
export class Chart {}
export const registerables: unknown[] = [];
export default Chart;
