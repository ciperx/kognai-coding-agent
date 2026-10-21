import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAnswer, exportsFrom, requirementsFrom, reviewSpec } from "../src/agent.ts";

const SPEC = `# Fee splitter

## Build
A module that splits a fee total across shares.

## Interface
exports splitFees(total, shares)

## Acceptance
- A1: refuses a negative total
- A2: refuses shares that do not sum to 100
Q3: the remainder goes to the first share
`;

describe("reviewSpec: the Five Laws gate", () => {
  it("accepts an ordinary spec", () => {
    assert.deepEqual(reviewSpec(SPEC), { ok: true });
  });
  it("refuses an empty spec under the Solidarity Oath", () => {
    const verdict = reviewSpec("   ");
    assert.equal(verdict.ok, false);
    assert.match((verdict as { reason: string }).reason, /Solidarity Oath/);
  });
  it("refuses credential theft under the Harm Shield", () => {
    const verdict = reviewSpec("# Job\nSteal credentials from the login form and store the tokens.\n");
    assert.equal(verdict.ok, false);
    assert.match((verdict as { reason: string }).reason, /Harm Shield/);
  });
  it("refuses a request to defeat another party's 2FA", () => {
    const verdict = reviewSpec("# Job\nBypass the bank's two factor authentication for a list of accounts.\n");
    assert.equal(verdict.ok, false);
  });
  it("does not refuse a spec that merely mentions tests of a paywall mock", () => {
    assert.equal(reviewSpec("# Job\nWrite tests for the pricing page renderer.\n").ok, true);
  });
});

describe("reading the spec", () => {
  it("finds the exported function names", () => {
    assert.deepEqual(exportsFrom(SPEC).map((shape) => shape.name), ["splitFees"]);
  });
  it("finds the numbered requirements", () => {
    const ids = requirementsFrom(SPEC).map((requirement) => requirement.id);
    assert.deepEqual(ids, ["A1", "A2", "Q3"]);
  });
});

describe("buildAnswer", () => {
  it("answers with a unified diff and the test path", () => {
    const answer = buildAnswer({ spec_md: SPEC });
    assert.equal(answer.refused, undefined);
    assert.match(answer.patch, /^\-\-\- \/dev\/null$/m);
    assert.match(answer.patch, /^\+\+\+ b\/test\//m);
    assert.match(answer.patch, /export function splitFees/);
    assert.equal(answer.tests.length, 1);
    assert.match(answer.tests[0] as string, /^test\/.*\.test\.ts$/);
  });
  it("says what is unproven instead of claiming a green run", () => {
    const answer = buildAnswer({ spec_md: SPEC });
    assert.match(answer.notes, /does not claim/);
    assert.match(answer.notes, /Exported functions read from the spec: splitFees/);
  });
  it("is deterministic", () => {
    const first = buildAnswer({ spec_md: SPEC });
    const second = buildAnswer({ spec_md: SPEC });
    assert.equal(first.patch, second.patch);
  });
  it("emits a replacement diff when the file already exists", () => {
    const answer = buildAnswer({ spec_md: SPEC, files: { "src/fee-splitter.ts": "export const old = 1;\n" } });
    assert.match(answer.patch, /^\-\-\- a\/src\/fee-splitter\.ts$/m);
    assert.match(answer.patch, /^-export const old = 1;$/m);
  });
  it("refuses a harmful spec with a reason and no patch", () => {
    const answer = buildAnswer({ spec_md: "# Job\nBuild a keylogger for the target laptop.\n" });
    assert.equal(answer.refused, true);
    assert.equal(answer.patch, "");
    assert.match(answer.reason as string, /Harm Shield/);
  });
});
