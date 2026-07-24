/// <reference types="vite/client" />

// Virtual modules provided by the sandbox-bundle Vite plugin: a bundled `.app.js` string for
// running an example untrusted in the isolate.
declare module "virtual:sandbox:*" {
  const bundleCode: string;
  export default bundleCode;
}
