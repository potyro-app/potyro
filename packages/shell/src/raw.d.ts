// Vite `?raw` imports return the file's text — used to inline the isolate stub sources into the
// runtime app bundler.
declare module "*?raw" {
  const contents: string;
  export default contents;
}
