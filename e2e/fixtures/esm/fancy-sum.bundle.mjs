/* fixture: a library with a dependency of its own, fetched by absolute path like esm.sh serves it */
import { twice } from "/tiny-twice@0.1.0/es2022/tiny-twice.mjs";
export const describe = (n) => "fancy-sum says " + twice(n);
