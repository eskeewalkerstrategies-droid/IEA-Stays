import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";

/**
 * Posts text to the connected personal LinkedIn profile with the official Posts API.
 * Scope needed: w_member_social (Share on LinkedIn product). Tokens last 60 days; the health check
 * warns 7 days before expiry. Token and person URN are stored in settings after GET /auth/linkedin.
 */
export interface LinkedInToken {
  access_token: string;
  expires_at: string; // ISO
  person_urn: string;
}

export async function getLinkedInToken(): Promise<LinkedInToken | null> {
  const c = config();
  const stored = await getSetting<LinkedInToken | null>("linkedin_token", null);
  if (stored?.access_token) return stored;
  if (c.LINKEDIN_ACCESS_TOKEN && c.LINKEDIN_PERSON_URN) {
    return { access_token: c.LINKEDIN_ACCESS_TOKEN, expires_at: c.LINKEDIN_TOKEN_EXPIRES_AT ?? "", person_urn: c.LINKEDIN_PERSON_URN };
  }
  return null;
}

export async function storeLinkedInToken(t: LinkedInToken): Promise<void> {
  await setSetting("linkedin_token", t);
}

export function linkedInAuthUrl(state: string): string {
  const c = config();
  const redirect = `${c.PUBLIC_URL}/auth/linkedin/callback`;
  const p = new URLSearchParams({
    response_type: "code",
    client_id: c.LINKEDIN_CLIENT_ID ?? "",
    redirect_uri: redirect,
    state,
    scope: "openid profile w_member_social",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${p.toString()}`;
}

export async function exchangeLinkedInCode(code: string): Promise<LinkedInToken> {
  const c = config();
  const redirect = `${c.PUBLIC_URL}/auth/linkedin/callback`;
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: c.LINKEDIN_CLIENT_ID ?? "",
      client_secret: c.LINKEDIN_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status} ${await res.text()}`);
  const tok = (await res.json()) as { access_token: string; expires_in: number };
  const me = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!me.ok) throw new Error(`LinkedIn userinfo failed: ${me.status}`);
  const info = (await me.json()) as { sub: string };
  const t: LinkedInToken = {
    access_token: tok.access_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    person_urn: `urn:li:person:${info.sub}`,
  };
  await storeLinkedInToken(t);
  return t;
}

export async function postToLinkedIn(text: string, opts: { articleUrl?: string; title?: string } = {}): Promise<{ id: string }> {
  const t = await getLinkedInToken();
  if (!t) throw new Error("LinkedIn is not connected. Open /auth/linkedin once.");
  const body: Record<string, unknown> = {
    author: t.person_urn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (opts.articleUrl) body.content = { article: { source: opts.articleUrl, title: opts.title ?? opts.articleUrl } };
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202511",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LinkedIn post failed: ${res.status} ${await res.text()}`);
  return { id: res.headers.get("x-restli-id") ?? "" };
}

export async function linkedInDaysLeft(): Promise<number | null> {
  const t = await getLinkedInToken();
  if (!t?.expires_at) return null;
  return Math.floor((new Date(t.expires_at).getTime() - Date.now()) / 86_400_000);
}
