// The loop's verify contract and the shell's implementation are declared in different packages
// (@karta/generator's agent loop, @karta/shell's verifyCandidate) and nothing else connects them
// yet — the loop UI that will actually wire one to the other doesn't exist. This file is that
// connection at the type level only: no runtime behaviour, just a function that WOULD satisfy
// `LoopDeps["verify"]` if it existed, checked by the compiler on every typecheck.
//
// `verifyCandidate` takes one argument (`{ source, theCase, storeForTests? }`), while
// `LoopDeps["verify"]` takes one string (`candidate`). Those are genuinely different shapes — the
// real caller closes over the user's recorded `Case` up front and hands the loop a `(source) =>
// verifyCandidate({ source, theCase })` closure. `makeVerify` below is exactly that closure-maker,
// so assigning its result to `LoopDeps["verify"]` is a real structural check, not a forced cast:
// if `verifyCandidate`'s signature or `LoopDeps["verify"]`'s ever drift apart, this stops compiling.

import type { LoopDeps } from "@karta/generator/agent";
import type { Case } from "@karta/runtime";
import { verifyCandidate } from "./verify-candidate.js";

function makeVerify(theCase: Case): LoopDeps["verify"] {
  return (source) => verifyCandidate({ source, theCase });
}

void makeVerify;
