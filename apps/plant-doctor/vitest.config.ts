import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-plant-doctor",
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Dates are calendar days in the device's zone: the tests pin one with daylight time, so "in 7
    // days" and the change to winter time mean the same on every machine that runs them.
    env: { TZ: "Europe/Warsaw" },
  },
});
