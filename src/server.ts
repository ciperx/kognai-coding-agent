import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { buildAnswer, type AgentRequest } from "./agent.ts";
import { createPaidRoute, USDC, type Facilitator } from "../qualifier/Q2/paid-route.ts";

const FACILITATOR_URL = process.env["X402_FACILITATOR_URL"] ?? "https://facilitator.payai.network";
const PAY_TO = process.env["X402_PAY_TO"] ?? "0x27EbD1DDCB6607bE8641784A1bf654623Fc8290e";
const NETWORK = process.env["X402_NETWORK"] ?? "base";
const PRICE = process.env["X402_PRICE"] ?? "0.25";

/** The PayAI facilitator: verify then settle, exactly the two calls the x402 contract names. */
export function httpFacilitator(baseUrl: string = FACILITATOR_URL): Facilitator {
  async function call(route: string, paymentPayload: unknown, requirements: unknown) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    return body;
  }
  return {
    async verify(paymentPayload, requirements) {
      const body = await call("verify", paymentPayload, requirements);
      return {
        isValid: body["isValid"] === true,
        ...(typeof body["invalidReason"] === "string" ? { invalidReason: body["invalidReason"] } : {}),
        ...(typeof body["payer"] === "string" ? { payer: body["payer"] } : {}),
      };
    },
    async settle(paymentPayload, requirements) {
      const body = await call("settle", paymentPayload, requirements);
      return {
        success: body["success"] === true,
        ...(typeof body["transaction"] === "string" ? { transaction: body["transaction"] } : {}),
        ...(typeof body["network"] === "string" ? { network: body["network"] } : {}),
        ...(typeof body["errorReason"] === "string" ? { errorReason: body["errorReason"] } : {}),
      };
    },
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

/** The whole service: POST /patch behind x402, plus free /health and /lax-offer. */
export function createHandler(options: { facilitator: Facilitator }) {
  const asset = USDC[NETWORK];
  if (!asset) throw new Error(`no USDC asset known for network ${NETWORK}`);
  const paidRoute = createPaidRoute({
    price: PRICE,
    payTo: PAY_TO,
    network: NETWORK,
    facilitator: options.facilitator,
    asset,
    description: "A coding agent call: spec in, patch and tests out",
  });

  return async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? "/";
    if (url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, price: PRICE, network: NETWORK }));
      return;
    }
    if (url === "/lax-offer") {
      const { readFile } = await import("node:fs/promises");
      const offer = await readFile(new URL("../qualifier/Q3/lax-offer.json", import.meta.url), "utf8");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(offer);
      return;
    }
    if (url !== "/patch") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const body = await readBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    const proxied = new Request(`http://${request.headers.host ?? "localhost"}${url}`, {
      method: request.method ?? "POST",
      headers,
      ...(request.method === "POST" ? { body } : {}),
    });
    const gate = await paidRoute(proxied);
    if (gate.status !== 200) {
      response.writeHead(gate.status, Object.fromEntries(gate.headers.entries()));
      response.end(await gate.text());
      return;
    }

    let payload: AgentRequest;
    try {
      payload = JSON.parse(body) as AgentRequest;
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "body must be JSON" }));
      return;
    }
    let answer;
    try {
      answer = buildAnswer(payload);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: (error as Error).message }));
      return;
    }
    const headersOut: Record<string, string> = {
      "content-type": "application/json",
      "x-payment-response": gate.headers.get("x-payment-response") ?? "",
    };
    response.writeHead(200, headersOut);
    response.end(JSON.stringify(answer));
  };
}

export function start(port: number, facilitator: Facilitator = httpFacilitator()) {
  const server = createServer(createHandler({ facilitator }));
  server.listen(port);
  return server;
}

if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const port = Number(process.env["PORT"] ?? 8080);
  start(port);
  console.log(`charter coding agent on :${port}, price ${PRICE} USDC on ${NETWORK}`);
}
