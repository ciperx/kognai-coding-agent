// Writes qualifier/Qn/transcript.json from a real HTTP call to the local /patch endpoint.
// The facilitator here is a stub: it answers verify and settle without moving funds,
// and every transcript says so instead of implying a payment happened.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createHandler } from "../src/server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const TASKS: Array<{ id: string; statement: string }> = [
  { id: "Q1", statement: "qualifier/Q1/plain-amount.ts exports plainAmount(value, decimals, symbol) -> string. value is an integer number of base units as a string, which may start with a minus sign and may use Arabic Indic digits. The result uses Latin digits, groups thousands with commas, keeps at least 2 and at most decimals decimals, and writes a negative value as minus 1,234.50 USDC, never a dash. Invalid input throws." },
  { id: "Q2", statement: "qualifier/Q2/paid-route.ts exports createPaidRoute({price, payTo, network, facilitator}) -> (request: Request) => Promise<Response>, with the x402 contract: 402 with payment requirements, then verify, settle, 200 with X-PAYMENT-RESPONSE." },
  { id: "Q3", statement: "qualifier/Q3/lax-offer.json is a LAX offer for the coding agent that passes the registry validation: name, description, endpoint, capabilities priced in USDC over x402, and the Five Laws in constitutional_constraints." },
  { id: "Q4", statement: "qualifier/Q4/ledger.ts exports createLedger({cap}) -> {post({key, account, amount}) -> {id, duplicate}, balance(account) -> string}. The same key with the same payload is posted once; the same key with another payload throws; a post that would take an account above cap throws and changes nothing." },
  { id: "Q5", statement: "qualifier/Q5/split.test.ts holds tests for splitFees(total, shares): they pass on the original and fail on every planted bug." },
];

const handler = createHandler({
  facilitator: {
    async verify() {
      return { isValid: true, payer: "0x27EbD1DDCB6607bE8641784A1bf654623Fc8290e" };
    },
    async settle() {
      return { success: true, transaction: "0xstub-no-funds-moved", network: "base" };
    },
  },
});

async function main() {
  const { createServer } = await import("node:http");
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/patch`;

  for (const task of TASKS) {
    const body = { spec_md: `# ${task.id}\n\n## Build\n${task.statement}\n`, files: {} };
    const request = {
      method: "POST",
      url: "/patch",
      body,
      headers: {
        "content-type": "application/json",
        "x-payment": Buffer.from(JSON.stringify({ scheme: "exact", network: "base", payload: { signature: "0xstub" } })).toString("base64"),
      },
    };
    const response = await fetch(url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
    });
    const answer = await response.json();
    const transcript = {
      task: task.id,
      generated_at: new Date().toISOString(),
      payment: "stub facilitator: verify and settle answered without moving funds",
      request: { method: request.method, url: request.url, headers: { "content-type": "application/json", "x-payment": "<base64 payment payload>" }, body },
      response: {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type"),
          "x-payment-response": response.headers.get("x-payment-response"),
        },
        answer,
      },
    };
    const dir = path.join(root, "qualifier", task.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const answerShape = answer as { refused?: boolean; tests?: string[]; patch?: string };
    console.log(task.id, response.status, "refused:", answerShape.refused ?? false,
      "patch bytes:", (answerShape.patch ?? "").length, "tests:", (answerShape.tests ?? []).length);
  }

  // Q3 also carries the offer itself, copied so the qualifier folder is self contained.
  const offer = readFileSync(path.join(root, "qualifier/Q3/lax-offer.json"), "utf8");
  JSON.parse(offer);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
