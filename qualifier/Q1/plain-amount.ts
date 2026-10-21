const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";
const MINUS_SIGNS = ["-", "\u2212", "\u2013", "\u2014"];

function toLatin(input: string): string {
  let out = "";
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) { out += String(a); continue; }
    const e = EXTENDED_ARABIC_INDIC.indexOf(ch);
    if (e >= 0) { out += String(e); continue; }
    out += ch;
  }
  return out;
}

function group(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * Render an integer amount of base units as a human string.
 * Latin digits only, thousands separated by commas, between 2 and `decimals`
 * decimals, a negative value written as "minus 1,234.50 USDC" and never a dash.
 */
export function plainAmount(value: string, decimals: number, symbol: string): string {
  if (typeof value !== "string") throw new Error("value must be a string");
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    throw new Error("symbol must be a non empty string");
  }
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 2 || decimals > 36) {
    throw new Error("decimals must be an integer between 2 and 36");
  }
  if (value.length === 0) throw new Error("value must not be empty");

  let raw = toLatin(value.trim());
  let negative = false;
  for (const sign of MINUS_SIGNS) {
    if (raw.startsWith(sign)) {
      negative = true;
      raw = raw.slice(sign.length);
      break;
    }
  }
  if (raw.length === 0 || !/^[0-9]+$/.test(raw)) {
    throw new Error("value must be an integer number of base units");
  }

  const digits = BigInt(raw).toString();
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fractionFull = padded.slice(padded.length - decimals);
  let fraction = fractionFull.replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");

  const body = `${group(whole)}.${fraction} ${symbol}`;
  return negative ? `minus ${body}` : body;
}
