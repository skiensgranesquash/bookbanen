import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Verifiserer at et innkommende webhook-kall faktisk kommer fra Vipps.
 * Implementert etter Vipps' spesifikasjon:
 * https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication/
 *
 * Vipps signerer forespørselen med HMAC-SHA256 og sender:
 * - "x-ms-date": tidspunktet forespørselen ble sendt
 * - "x-ms-content-sha256": base64(SHA-256(body))
 * - "Authorization": "HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=<sig>"
 *
 * Signert streng (linjeskift = \n): POST\n<path+query>\n<date>;<host>;<contentHash>
 * Nøkkelen er webhook-secret-en vi fikk ved registrering (se
 * scripts/register-webhook.ts), brukt direkte som UTF-8-streng.
 *
 * VIKTIG: body må leses som RÅ tekst (`await request.text()`), IKKE
 * `request.json()`, før denne funksjonen kalles.
 */
export interface VerifyWebhookInput {
  method: string;
  url: string;
  rawBody: string;
  headers: { get(name: string): string | null };
  secret: string;
}

export function verifyVippsWebhookSignature(input: VerifyWebhookInput): boolean {
  const { method, url, rawBody, headers, secret } = input;

  const date = headers.get("x-ms-date");
  const contentHashHeader = headers.get("x-ms-content-sha256");
  const authorization = headers.get("authorization");
  const host = headers.get("host");

  if (!date || !contentHashHeader || !authorization || !host) return false;

  const actualContentHash = createHash("sha256").update(rawBody, "utf8").digest("base64");
  if (actualContentHash !== contentHashHeader) return false;

  const signatureMatch = authorization.match(/Signature=(.+)$/);
  if (!signatureMatch) return false;
  const providedSignature = signatureMatch[1];

  const parsedUrl = new URL(url);
  const pathAndQuery = parsedUrl.pathname + parsedUrl.search;
  const signedString = `${method.toUpperCase()}\n${pathAndQuery}\n${date};${host};${contentHashHeader}`;
  const expectedSignature = createHmac("sha256", secret).update(signedString).digest("base64");

  return timingSafeEqualStrings(expectedSignature, providedSignature);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
