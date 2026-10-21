# Charter coding agent

A coding agent for the Kognai/LAX market: `POST /patch` takes a job spec (and optionally the current
files) and answers with a unified diff, the test paths it adds, and notes that name what is not proven.
Sold over x402 (USDC on Base), and it refuses work that breaks the Five Laws before it writes a line.

## What is here

- `src/agent.ts` - the work: `reviewSpec` (Five Laws gate), `requirementsFrom`, `exportsFrom`, `buildAnswer`.
  Pure and deterministic: the same request gives the same patch bytes.
- `src/server.ts` - `POST /patch` behind the x402 gate, plus free `GET /health` and `GET /lax-offer`.
  The default facilitator is PayAI (`https://facilitator.payai.network`), verify then settle.
- `qualifier/Q1/plain-amount.ts` - base units to a human amount, Arabic Indic digits in, Latin digits out.
- `qualifier/Q2/paid-route.ts` - the x402 route: 402 with requirements, verify, settle, 200 with `X-PAYMENT-RESPONSE`.
- `qualifier/Q3/lax-offer.json` - the LAX offer, with the Five Laws in `constitutional_constraints`.
- `qualifier/Q4/ledger.ts` - a capped, idempotent ledger.
- `qualifier/Q5/split.ts` and `split.test.ts` - fee splitting, tested against the bugs that usually creep in.
- `qualifier/Qn/transcript.json` - the real request and answer of the endpoint for each qualifier task.

## Run it

```sh
npm install
npm test          # test suites plus qualifier/Q5
npm run typecheck
npm run transcripts
PORT=8080 npm start
```

The transcripts are produced by calling the local endpoint with a stub facilitator: verify and settle
answer without moving funds, and each transcript says so. No transcript claims a payment happened.

## The x402 contract

Request without a payment header gets 402 with `accepts[0]` naming `scheme: exact`, the network,
`maxAmountRequired` in USDC atomic units, `payTo`, `asset` and `maxTimeoutSeconds`. Repeat the call with
`X-PAYMENT` (base64 JSON) and the route verifies with the facilitator, settles, and answers 200 with an
`X-PAYMENT-RESPONSE` receipt that carries `success`, `transaction`, `network` and `payer`. A refused
payment is a 402 with the facilitator's reason in `error`; nothing downstream runs.

## What this agent does not do

It does not pretend to solve the spec. It reads the requirements and the exported names, emits the typed
interface and one shape test per requirement, and states in `notes` that the behaviour is unproven.
A run that claims otherwise would be a lie in the same format as a green test run.
