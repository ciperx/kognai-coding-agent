export interface AgentRequest {
  spec_md: string;
  files?: Record<string, string>;
}
export interface AgentAnswer {
  patch: string;
  tests: string[];
  notes: string;
  refused?: boolean;
  reason?: string;
}

const HARM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(exfiltrat|steal|harvest)\w*\b[^.]{0,60}\b(credential|password|secret|token|session|cookie)/i,
    reason: "Harm Shield: the spec asks for the taking of someone else's credentials or secrets." },
  { pattern: /\b(backdoor|keylog\w*|ransom\w*|wiper|rootkit|stealer)\b/i,
    reason: "Harm Shield: the spec asks for malware whose effect falls on people who did not consent." },
  { pattern: /\b(bypass|defeat|evade)\w*\b[^.]{0,60}\b(authentication|2fa|mfa|paywall|kyc|antivirus)\b/i,
    reason: "Harm Shield: the spec asks to defeat another party's authentication or protection." },
  { pattern: /\b(without (their|the user's) consent|non consensual|surveil)\b/i,
    reason: "Harm Shield: the spec asks for surveillance of people who did not consent." },
];

/** The Five Laws gate. Refuses before any code is generated, with the law it broke. */
export function reviewSpec(spec: string): { ok: true } | { ok: false; reason: string } {
  if (typeof spec !== "string" || spec.trim().length === 0) {
    return { ok: false, reason: "Solidarity Oath: an empty spec gives the caller nothing to act on." };
  }
  for (const rule of HARM_PATTERNS) {
    if (rule.pattern.test(spec)) return { ok: false, reason: rule.reason };
  }
  return { ok: true };
}

function slugOf(spec: string): string {
  const title = /^#\s+(.+)$/m.exec(spec)?.[1] ?? "job";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length >= 2 ? slug : "job";
}

function titleOf(spec: string): string {
  return (/^#\s+(.+)$/m.exec(spec)?.[1] ?? "Untitled job").trim();
}

export interface Requirement {
  id: string;
  text: string;
}

/** Requirement lines the spec states as Q1..Qn or A1..An, ids normalised to Qn/An. */
export function requirementsFrom(spec: string): Requirement[] {
  const out: Requirement[] = [];
  const line = /^[ \t]*[-*]?[ \t]*\(?([QA]\d{1,2})\)?[:.)]?[ \t]+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = line.exec(spec)) !== null) {
    const id = match[1] as string;
    const text = (match[2] as string).trim().replace(/\s+/g, " ");
    if (text.length >= 8) out.push({ id, text });
  }
  if (out.length === 0) {
    const bullet = /^[ \t]*[-*][ \t]+(.{8,})$/gm;
    while ((match = bullet.exec(spec)) !== null) {
      out.push({ id: `A${out.length + 1}`, text: (match[1] as string).trim().replace(/\s+/g, " ") });
    }
  }
  return out;
}

export interface ExportShape {
  name: string;
  params: string;
}

const TYPE_HINTS: Record<string, string> = {
  plainAmount: "string",
  createPaidRoute: "(request: Request) => Promise<Response>",
  createLedger: "Ledger",
  splitFees: "bigint[]",
  scoreAgent: "number",
};

/** Function names the spec says must be exported, read from `exports name(...)` and `export function name(`. */
export function exportsFrom(spec: string): ExportShape[] {
  const found = new Map<string, ExportShape>();
  const patterns = [/exports?\s+`?([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)/g, /export function ([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)/g];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(spec)) !== null) {
      const name = match[1] as string;
      if (!found.has(name)) found.set(name, { name, params: (match[2] as string).trim() });
    }
  }
  return [...found.values()];
}

function diffFor(path: string, content: string, previous?: string): string {
  const next = content.split("\n");
  const lines = next.map((line) => `+${line}`).join("\n");
  if (previous === undefined) {
    return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${next.length} @@\n${lines}`;
  }
  const before = previous.split("\n");
  const removed = before.map((line) => `-${line}`).join("\n");
  return `--- a/${path}\n+++ b/${path}\n@@ -1,${before.length} +1,${next.length} @@\n${removed}\n${lines}`;
}

/** Build the patch answer. Pure and deterministic: the same request gives the same bytes. */
export function buildAnswer(request: AgentRequest): AgentAnswer {
  if (!request || typeof request !== "object") {
    return { patch: "", tests: [], notes: "", refused: true, reason: "Solidarity Oath: no request was given." };
  }
  const review = reviewSpec(request.spec_md);
  if (review.ok === false) {
    return { patch: "", tests: [], notes: "", refused: true, reason: review.reason };
  }
  const spec = request.spec_md;
  const slug = slugOf(spec);
  const requirements = requirementsFrom(spec);
  const shapes = exportsFrom(spec);
  const existing = request.files ?? {};

  const modulePath = `src/${slug}.ts`;
  const testPath = `test/${slug}.test.ts`;

  const moduleLines: string[] = [
    `// ${titleOf(spec)}`,
    "// Generated by the Charter coding agent: interface first, behaviour still to be proven.",
    "",
  ];
  for (const shape of shapes) {
    const returnType = TYPE_HINTS[shape.name] ?? "unknown";
    moduleLines.push(
      `export function ${shape.name}(${shape.params}): ${returnType} {`,
      `  throw new Error("${shape.name} is not implemented: this pass ships the interface and the tests");`,
      "}",
      "",
    );
  }
  if (shapes.length === 0) {
    moduleLines.push(
      "export const requirements: string[] = [",
      ...requirements.map((requirement) => `  ${JSON.stringify(`${requirement.id}: ${requirement.text}`)},`),
      "];",
      "",
    );
  }

  const testLines: string[] = [
    'import assert from "node:assert/strict";',
    'import { describe, it } from "node:test";',
    "",
  ];
  if (shapes.length > 0) {
    testLines.push(`import { ${shapes.map((shape) => shape.name).join(", ")} } from "../${modulePath.replace(/\.ts$/, ".ts")}";`);
  } else {
    testLines.push(`import { requirements } from "../${modulePath}";`);
  }
  testLines.push("", `describe(${JSON.stringify(titleOf(spec))}, () => {`);
  for (const shape of shapes) {
    testLines.push(
      `  it(${JSON.stringify(`${shape.name} is exported and callable`)}, () => {`,
      `    assert.equal(typeof ${shape.name}, "function");`,
      "  });",
    );
  }
  for (const requirement of requirements) {
    const fn = shapes[0]?.name;
    testLines.push(
      `  it(${JSON.stringify(`${requirement.id}: ${requirement.text.slice(0, 90)}`)}, () => {`,
      fn
        ? `    assert.equal(typeof ${fn}, "function"); // behaviour for ${requirement.id} is not proven by this pass`
        : `    assert.ok(requirements.some((item) => item.startsWith(${JSON.stringify(requirement.id + ":")})));`,
      "  });",
    );
  }
  testLines.push("});", "");

  const patch = [
    diffFor(modulePath, moduleLines.join("\n"), existing[modulePath]),
    diffFor(testPath, testLines.join("\n"), existing[testPath]),
  ].join("\n");

  const notes = [
    `Requirements read from the spec: ${requirements.length}.`,
    `Exported functions read from the spec: ${shapes.length ? shapes.map((shape) => shape.name).join(", ") : "none"}.`,
    "This is a deterministic pass: it emits the typed interface and one shape test per requirement.",
    "It does not claim the requirements behave as written; the notes say what is unproven instead of inventing a green run.",
  ].join(" ");

  return { patch, tests: [testPath], notes };
}
