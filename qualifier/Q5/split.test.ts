import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitFees } from "./split.ts";

function sum(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

describe("splitFees: refusals", () => {
  it("refuses a negative total", () => {
    assert.throws(() => splitFees(-1n, [50, 50]), /negative total/);
    assert.throws(() => splitFees(-100n, [100]), /negative total/);
  });
  it("refuses an empty share list", () => {
    assert.throws(() => splitFees(100n, []), /bad shares/);
  });
  it("refuses a non integer share", () => {
    assert.throws(() => splitFees(100n, [50.5, 49.5]), /bad shares/);
    assert.throws(() => splitFees(100n, [50, 50, 0.0001]), /bad shares/);
  });
  it("refuses a negative share", () => {
    assert.throws(() => splitFees(100n, [150, -50]), /bad shares/);
  });
  it("refuses shares that do not sum to 100", () => {
    assert.throws(() => splitFees(100n, [50, 49]), /sum to 100/);
    assert.throws(() => splitFees(100n, [50, 51]), /sum to 100/);
  });
});

describe("splitFees: even divisions", () => {
  it("splits an amount divisible by the shares", () => {
    assert.deepEqual(splitFees(100n, [50, 50]), [50n, 50n]);
    assert.deepEqual(splitFees(1000n, [25, 25, 25, 25]), [250n, 250n, 250n, 250n]);
  });
  it("gives everything to a single 100 share", () => {
    assert.deepEqual(splitFees(12345n, [100]), [12345n]);
  });
  it("keeps a zero share at zero", () => {
    assert.deepEqual(splitFees(100n, [100, 0]), [100n, 0n]);
    assert.deepEqual(splitFees(7n, [0, 100]), [0n, 7n]);
  });
  it("splits zero", () => {
    assert.deepEqual(splitFees(0n, [50, 50]), [0n, 0n]);
    assert.deepEqual(splitFees(0n, [33, 33, 34]), [0n, 0n, 0n]);
  });
});

describe("splitFees: remainder", () => {
  it("gives the leftover unit to the first share and never loses a unit", () => {
    assert.deepEqual(splitFees(101n, [50, 50]), [51n, 50n]);
    assert.equal(sum(splitFees(101n, [50, 50])), 101n);
  });
  it("keeps the total across a three way split", () => {
    const out = splitFees(1000n, [33, 33, 34]);
    assert.equal(sum(out), 1000n);
    assert.deepEqual(out, [330n, 330n, 340n]);
    assert.equal(sum(splitFees(1001n, [33, 33, 34])), 1001n);
  });
  it("keeps the total for a tiny amount", () => {
    assert.deepEqual(splitFees(1n, [50, 50]), [1n, 0n]);
    assert.deepEqual(splitFees(1n, [33, 33, 34]), [1n, 0n, 0n]);
    assert.equal(sum(splitFees(2n, [50, 50])), 2n);
  });
  it("truncates each share before handing the remainder to the first", () => {
    assert.deepEqual(splitFees(99n, [33, 33, 34]), [34n, 32n, 33n]);
    assert.equal(sum(splitFees(99n, [33, 33, 34])), 99n);
  });
  it("keeps the total for large bigint amounts", () => {
    const total = 10n ** 18n + 1n;
    const out = splitFees(total, [33, 33, 34]);
    assert.equal(sum(out), total);
    assert.equal(out[1], (total * 33n) / 100n);
    assert.equal(out[2], (total * 34n) / 100n);
    assert.equal(out[0], total - out[1] - out[2]);
    assert.ok(out[0] > (total * 33n) / 100n);
  });
  it("keeps the total when many shares take one percent each", () => {
    const shares = new Array<number>(100).fill(1);
    const out = splitFees(50n, shares);
    assert.equal(out.length, 100);
    assert.equal(sum(out), 50n);
    assert.equal(out[0], 50n);
    assert.equal(sum(out.slice(1)), 0n);
  });
});
