import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-pantry",
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Dates are calendar days in the device's zone: the tests pin one with daylight time, so "tomorrow"
    // and the change to winter time mean the same on every machine that runs them.
    env: { TZ: "Europe/Warsaw" },
  },
});
