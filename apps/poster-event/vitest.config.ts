import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-poster-event",
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Dates are wall times in the device's zone: the tests pin one that has daylight time, so "20:00 on
    // the poster" and the change to winter time mean the same on every machine that runs them.
    env: { TZ: "Europe/Warsaw" },
  },
});
