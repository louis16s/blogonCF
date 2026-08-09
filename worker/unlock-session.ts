const SESSION_TTL_SECONDS = 30 * 60;
const COOKIE_PREFIX = "blog_unlock_";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizedSlug(slug: string): string {
  return slug.normalize("NFC").toLocaleLowerCase();
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function cookieName(slug: string): Promise<string> {
  return COOKIE_PREFIX + base64Url(await digest(normalizedSlug(slug))).slice(0, 16);
}

async function signature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}

export async function createUnlockCookie(secret: string, slug: string, requestUrl: string): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ slug: normalizedSlug(slug), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })));
  const token = `${payload}.${await signature(secret, payload)}`;
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${await cookieName(slug)}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export async function hasUnlockSession(request: Request, secret: string, slug: string): Promise<boolean> {
  const name = await cookieName(slug);
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!token) return false;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return false;
  try {
    const expected = await signature(secret, payload);
    const left = decodeBase64Url(suppliedSignature);
    const right = decodeBase64Url(expected);
    if (left.byteLength !== right.byteLength) return false;
    let mismatch = 0;
    for (let index = 0; index < left.byteLength; index++) mismatch |= left[index] ^ right[index];
    if (mismatch) return false;
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { slug?: unknown; exp?: unknown };
    return value.slug === normalizedSlug(slug) && typeof value.exp === "number" && value.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
