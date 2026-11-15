import { createRemoteJWKSet, jwtVerify } from "jose";

const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export const googleCallback = "/api/auth/google/callback";

export async function googleAuthorizationUrl(options: {
  clientId: string;
  origin: string;
  state: string;
  verifier: string;
  nonce: string;
}) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(options.verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.origin + googleCallback,
    response_type: "code",
    scope: "openid email",
    state: options.state,
    nonce: options.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function verifyGoogleSignIn(options: {
  clientId: string;
  clientSecret: string;
  origin: string;
  code: string;
  verifier: string;
  nonce: string;
}) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    redirect: "error",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.origin + googleCallback,
      code_verifier: options.verifier,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Google did not accept the sign-in code.");
  const data = await response.json<{ id_token?: unknown }>();
  if (typeof data.id_token !== "string")
    throw new Error("Google returned no identity token.");
  const { payload } = await jwtVerify(data.id_token, keys, {
    algorithms: ["RS256"],
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: options.clientId,
    maxTokenAge: "10m",
    clockTolerance: 30,
    requiredClaims: ["sub", "exp", "email", "nonce"],
  });
  if (
    payload.nonce !== options.nonce ||
    (payload.azp !== undefined && payload.azp !== options.clientId) ||
    !payload.sub ||
    payload.sub.length > 255 ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  )
    throw new Error("Google account verification failed.");
  return { subject: payload.sub, email: payload.email.trim().toLowerCase() };
}
