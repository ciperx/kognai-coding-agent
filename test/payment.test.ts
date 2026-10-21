import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPaidRoute, USDC, type Facilitator } from "../qualifier/Q2/paid-route.ts";

const PAY_TO = "0x27EbD1DDCB6607bE8641784A1bf654623Fc8290e";

function stub(overrides: Partial<Facilitator> = {}): Facilitator {
  return {
    async verify() {
      return { isValid: true, payer: PAY_TO };
    },
    async settle() {
      return { success: true, transaction: "0xtx", network: "base" };
    },
    ...overrides,
  };
}

function payment(header: object = { scheme: "exact", network: "base", payload: { signature: "0xsig" } }): Request {
  return new Request("https://agent.example/patch", {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(header)).toString("base64") },
    body: JSON.stringify({ spec_md: "# Job" }),
  });
}

const decorate = (text: string) => ((text.length + 63) / 64) * 64;

describe("createPaidRoute: construction", () => {
  it("refuses a payee that is not an address", () => {
    assert.throws(() => createPaidRoute({ price: "0.25", payTo: "nope", network: "base", facilitator: stub() }), /payTo/);
  });
  it("refuses a network without a known USDC asset", () => {
    assert.throws(() => createPaidRoute({ price: "0.25", payTo: PAY_TO, network: "unknownnet", facilitator: stub() }), /USDC/);
  });
  it("refuses a zero price", () => {
    assert.throws(() => createPaidRoute({ price: "0", payTo: PAY_TO, network: "base", facilitator: stub() }), /price/);
  });
  it("knows the Base USDC address", () => {
    assert.match(USDC["base"] as string, /^0x833589/);
  });
});

describe("createPaidRoute: the gate", () => {
  it("answers 402 with the requirements when there is no payment header", async () => {
    const route = createPaidRoute({ price: "0.25", payTo: PAY_TO, network: "base", facilitator: stub() });
    const response = await route(new Request("https://agent.example/patch", { method: "POST" }));
    assert.equal(response.status, 402);
    const body = (await response.json()) as { x402Version: number; accepts: Array<Record<string, string>> };
    assert.equal(body.x402Version, 1);
    assert.equal(body.accepts.length, 1);
    assert.equal(body.accepts[0]?.["scheme"], "exact");
    assert.equal(body.accepts[0]?.["network"], "base");
    assert.equal(body.accepts[0]?.["maxAmountRequired"], "250000");
    assert.equal(body.accepts[0]?.["payTo"], PAY_TO);
    assert.equal(body.accepts[0]?.["asset"], USDC["base"]);
    assert.ok(response.headers.get("x-payment-required"));
  });
  it("answers 405 for a GET", async () => {
    const route = createPaidRoute({ price: "0.25", payTo: PAY_TO, network: "base", facilitator: stub() });
    const response = await route(new Request("https://agent.example/patch", { method: "GET" }));
    assert.equal(response.status, 405);
  });
  it("answers 402 when the payload is not base64 JSON", async () => {
    const route = createPaidRoute({ price: "0.25", payTo: PAY_TO, network: "base", facilitator: stub() });
    const response = await route(new Request("https://agent.example/patch", {
      method: "POST",
      headers: { "x-payment": "not base64 json" },
    }));
    assert.equal(response.status, 402);
    assert.match(((await response.json()) as { error: string }).error, /invalid payment payload/);
  });
  it("answers 402 and names the reason when verify says no", async () => {
    const route = createPaidRoute({ price: "0.25", payTo: PAY_TO, network: "base", facilitator: stub({
      async verify() { return { isValid: false, invalidReason: "insufficient amount" }; },
    }) });
    const response = await route(payment());
    assert.equal(response.status, 402);
    assert.match(((await response.json()) as { error: string }).error, /insufficient amount/);
  });
  it("answers 402 when settle does not succeed", async () => {
    const route = createPaidRoute({ price: "0.25", payTo: PAY_TO, network: "base", facilitator: stub({
      async settle() { return { success: false, errorReason: "settlement reverted" }; },
    }) });
    const response = await route(payment());
    assert.equal(response.status, 402);
    assert.match(((await response.json()) as { error: string }).error, /settlement reverted/);
  });
  it("answers 200 with X-PAYMENT-RESPONSE after verify and settle", async () => {
    const calls: string[] = [];
    const route = createPaidRoute({ price: "0.25", payTo: PAY_TO, network: "base", facilitator: stub({
      async verify(_payload, requirements) {
        calls.push(`verify:${(requirements as { maxAmountRequired: string }).maxAmountRequired}`);
        return { isValid: true, payer: PAY_TO };
      },
      async settle() {
        calls.push("settle");
        return { success: true, transaction: "0xabc", network: "base" };
      },
    }) });
    const response = await route(payment());
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["verify:250000", "settle"]);
    const receipt = JSON.parse(Buffer.from(response.headers.get("x-payment-response") ?? "", "base64").toString("utf8"));
    assert.deepEqual(receipt, { success: true, transaction: "0xabc", network: "base", payer: PAY_TO });
  });
  it("prices a decimal amount in atomic units", async () => {
    const route = createPaidRoute({ price: "1.5", payTo: PAY_TO, network: "base", facilitator: stub() });
    const body = (await (await route(new Request("https://agent.example/patch", { method: "POST" }))).json()) as {
      accepts: Array<{ maxAmountRequired: string }>;
    };
    assert.equal(body.accepts[0]?.maxAmountRequired, "1500000");
  });
});
