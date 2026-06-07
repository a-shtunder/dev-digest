// Insecure deserialization / code injection via eval (A03 / A08).

// Evaluates attacker-controlled input as code.
export function compute(expr: string): unknown {
  // eslint-disable-next-line no-eval
  return eval(expr);
}

// "Parses" a payload by eval-ing it instead of JSON.parse — RCE.
export function parsePayload(raw: string): unknown {
  return eval("(" + raw + ")");
}
