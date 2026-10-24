// What an app declares, as plain data that travels in a package's manifest (#271). It lives in
// `potyro` (packages/schema/src/declaration.ts) because `potyro pack` writes it on the author's
// machine, outside this repo; the store reads it back from here.
export { FN_MARKER, declareApp, describeApp, parseDeclaration, declarationProblem, type AppDeclaration } from "potyro";
