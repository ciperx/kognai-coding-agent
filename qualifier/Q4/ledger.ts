import { createHash } from "node:crypto";

export interface PostInput {
  key: string;
  account: string;
  amount: string;
}
export interface PostResult {
  id: string;
  duplicate: boolean;
}
export interface Ledger {
  post(input: PostInput): PostResult;
  balance(account: string): string;
}

const INTEGER = /^[0-9]+$/;

function positiveInteger(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !INTEGER.test(value)) {
    throw new Error(`${field} must be a positive integer written as a string`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${field} must be positive`);
  return parsed;
}

/** A capped, idempotent in memory ledger. Amounts and the cap are positive integers as strings. */
export function createLedger(options: { cap: string }): Ledger {
  if (!options || typeof options !== "object") throw new Error("cap is required");
  const cap = positiveInteger(options.cap, "cap");
  const balances = new Map<string, bigint>();
  const seen = new Map<string, { fingerprint: string; entry: PostResult }>();

  function idFor(key: string, account: string, amount: string): string {
    return "lg_" + createHash("sha256")
      .update([key, account, amount].join("\u0000"))
      .digest("hex")
      .slice(0, 24);
  }

  return {
    post(input: PostInput): PostResult {
      if (!input || typeof input !== "object") throw new Error("post input is required");
      if (typeof input.key !== "string" || input.key.length === 0) {
        throw new Error("key must be a non empty string");
      }
      if (typeof input.account !== "string" || input.account.length === 0) {
        throw new Error("account must be a non empty string");
      }
      const amount = positiveInteger(input.amount, "amount");
      const fingerprint = [input.account, amount.toString()].join("\u0000");
      const previous = seen.get(input.key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          throw new Error("key was already used with another payload");
        }
        return { id: previous.entry.id, duplicate: true };
      }
      const current = balances.get(input.account) ?? 0n;
      if (current + amount > cap) {
        throw new Error("post would take the account above the cap");
      }
      const entry: PostResult = {
        id: idFor(input.key, input.account, amount.toString()),
        duplicate: false,
      };
      balances.set(input.account, current + amount);
      seen.set(input.key, { fingerprint, entry });
      return { id: entry.id, duplicate: false };
    },
    balance(account: string): string {
      if (typeof account !== "string" || account.length === 0) {
        throw new Error("account must be a non empty string");
      }
      return (balances.get(account) ?? 0n).toString();
    },
  };
}
