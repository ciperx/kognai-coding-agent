export const USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}
export interface SettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  errorReason?: string;
}
export interface Facilitator {
  verify(paymentPayload: unknown, requirements: Record<string, unknown>): Promise<VerifyResult>;
  settle(paymentPayload: unknown, requirements: Record<string, unknown>): Promise<SettleResult>;
}
export interface PaidRouteOptions {
  price: string | number | bigint;
  payTo: string;
  network: string;
  facilitator: Facilitator;
  asset?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
}

const DEFAULT_DESCRIPTION = "A coding agent call: spec in, patch and tests out";

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function atomicPrice(price: string | number | bigint): string {
  if (typeof price === "bigint") {
    if (price <= 0n) throw new Error("price must be positive");
    return price.toString();
  }
  if (typeof price === "number") {
    if (!Number.isFinite(price) || price <= 0) throw new Error("price must be positive");
    if (!Number.isInteger(price)) return atomicPrice(price.toFixed(6));
    return BigInt(price).toString();
  }
  const text = price.trim();
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(text)) throw new Error("price must be a USDC decimal");
  if (text.includes(".")) {
    const [whole, fraction = ""] = text.split(".");
    const atomic = BigInt(whole + fraction.padEnd(6, "0"));
    if (atomic <= 0n) throw new Error("price must be positive");
    return atomic.toString();
  }
  const atomic = BigInt(text);
  if (atomic <= 0n) throw new Error("price must be positive");
  return atomic.toString();
}

export function createPaidRoute(options: PaidRouteOptions): (request: Request) => Promise<Response> {
  if (!options || typeof options !== "object") throw new Error("options are required");
  if (typeof options.payTo !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(options.payTo)) {
    throw new Error("payTo must be an address");
  }
  if (typeof options.network !== "string" || options.network.length === 0) {
    throw new Error("network must be a CAIP id or a network name");
  }
  const asset = options.asset ?? USDC[options.network];
  if (!asset) throw new Error(`no USDC asset known for network ${options.network}`);
  if (!options.facilitator || typeof options.facilitator.verify !== "function"
      || typeof options.facilitator.settle !== "function") {
    throw new Error("facilitator must expose verify and settle");
  }
  const amount = atomicPrice(options.price);

  return async function paidRoute(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json", allow: "POST" },
      });
    }
    const requirements = {
      scheme: "exact",
      network: options.network,
      maxAmountRequired: amount,
      resource: options.resource ?? request.url,
      description: options.description ?? DEFAULT_DESCRIPTION,
      mimeType: options.mimeType ?? "application/json",
      payTo: options.payTo,
      maxTimeoutSeconds: options.maxTimeoutSeconds ?? 60,
      asset,
      extra: { name: "USDC", version: "2" },
    };
    const paymentRequired = {
      x402Version: 1,
      error: "X-PAYMENT header is required",
      accepts: [requirements],
    };
    const header = request.headers.get("x-payment") ?? request.headers.get("payment-signature");
    if (!header) {
      return new Response(JSON.stringify(paymentRequired), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "x-payment-required": b64(paymentRequired),
        },
      });
    }
    let paymentPayload: unknown;
    try {
      paymentPayload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    } catch {
      return new Response(JSON.stringify({ ...paymentRequired, error: "invalid payment payload" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }

    let verification: VerifyResult;
    try {
      verification = await options.facilitator.verify(paymentPayload, requirements);
    } catch (error) {
      return new Response(JSON.stringify({
        ...paymentRequired,
        error: `verification failed: ${(error as Error).message}`,
      }), { status: 402, headers: { "content-type": "application/json" } });
    }
    if (!verification || verification.isValid !== true) {
      return new Response(JSON.stringify({
        ...paymentRequired,
        error: verification?.invalidReason ?? "payment is not valid",
      }), { status: 402, headers: { "content-type": "application/json" } });
    }

    let settlement: SettleResult;
    try {
      settlement = await options.facilitator.settle(paymentPayload, requirements);
    } catch (error) {
      return new Response(JSON.stringify({
        ...paymentRequired,
        error: `settlement failed: ${(error as Error).message}`,
      }), { status: 402, headers: { "content-type": "application/json" } });
    }
    if (!settlement || settlement.success !== true) {
      return new Response(JSON.stringify({
        ...paymentRequired,
        error: settlement?.errorReason ?? "settlement did not succeed",
      }), { status: 402, headers: { "content-type": "application/json" } });
    }

    const receipt = {
      success: true,
      transaction: settlement.transaction ?? "",
      network: settlement.network ?? options.network,
      payer: verification.payer ?? "",
    };
    return new Response(JSON.stringify({ ok: true, payer: receipt.payer }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-payment-response": b64(receipt),
      },
    });
  };
}
