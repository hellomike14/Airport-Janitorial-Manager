import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { quickbooksConnectionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

function getClientId() {
  return process.env.QUICKBOOKS_CLIENT_ID || "";
}
function getClientSecret() {
  return process.env.QUICKBOOKS_CLIENT_SECRET || "";
}
function isConfigured() {
  return Boolean(getClientId() && getClientSecret());
}

/**
 * Build the OAuth redirect URI. Prefer an explicit env override, otherwise
 * derive it from the incoming request (proxied through the Replit domain).
 */
function getRedirectUri(req: Request): string {
  if (process.env.QUICKBOOKS_REDIRECT_URI) {
    return process.env.QUICKBOOKS_REDIRECT_URI;
  }
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}/api/quickbooks/callback`;
}

// The SPA route to return the browser to after the OAuth dance.
function getAppReturnUrl(req: Request, params: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}/employment?tab=quickbooks&${params}`;
}

async function getConnection() {
  const [row] = await db.select().from(quickbooksConnectionsTable).limit(1);
  return row ?? null;
}

/**
 * GET /quickbooks/status — connection + configuration state.
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const conn = await getConnection();
    res.json({
      configured: isConfigured(),
      connected: conn?.status === "connected",
      realmId: conn?.realmId ?? null,
      companyName: conn?.companyName ?? null,
      connectedAt: conn?.connectedAt ? conn.connectedAt.toISOString() : null,
    });
  } catch (err) {
    console.error("Error fetching QuickBooks status:", err);
    res.status(500).json({ error: "Failed to fetch QuickBooks status" });
  }
});

/**
 * GET /quickbooks/connect — return the Intuit authorize URL.
 */
router.get("/connect", async (req: Request, res: Response) => {
  if (!isConfigured()) {
    res.status(409).json({
      error:
        "QuickBooks is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.",
    });
    return;
  }
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: "code",
    scope: SCOPE,
    redirect_uri: getRedirectUri(req),
    state,
  });
  res.json({ authorizeUrl: `${AUTH_BASE}?${params.toString()}` });
});

/**
 * GET /quickbooks/callback — exchange the auth code for tokens, store them,
 * and redirect the browser back to the Employment page.
 */
router.get("/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const realmId = typeof req.query.realmId === "string" ? req.query.realmId : "";
  const error = typeof req.query.error === "string" ? req.query.error : "";

  if (error) {
    res.redirect(getAppReturnUrl(req, `qb=error`));
    return;
  }
  if (!isConfigured() || !code) {
    res.redirect(getAppReturnUrl(req, `qb=error`));
    return;
  }

  try {
    const basic = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString("base64");
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(req),
      }),
    });

    if (!tokenRes.ok) {
      console.error("QuickBooks token exchange failed:", tokenRes.status, await tokenRes.text());
      res.redirect(getAppReturnUrl(req, `qb=error`));
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

    const existing = await getConnection();
    const values = {
      realmId: realmId || existing?.realmId || null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: expiresAt,
      status: "connected" as const,
      connectedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(quickbooksConnectionsTable)
        .set(values)
        .where(eq(quickbooksConnectionsTable.id, existing.id));
    } else {
      await db.insert(quickbooksConnectionsTable).values(values);
    }

    res.redirect(getAppReturnUrl(req, `qb=connected`));
  } catch (err) {
    console.error("Error in QuickBooks callback:", err);
    res.redirect(getAppReturnUrl(req, `qb=error`));
  }
});

/**
 * POST /quickbooks/disconnect — clear stored tokens.
 */
router.post("/disconnect", async (_req: Request, res: Response) => {
  try {
    const existing = await getConnection();
    if (existing) {
      await db
        .update(quickbooksConnectionsTable)
        .set({
          status: "disconnected",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          connectedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(quickbooksConnectionsTable.id, existing.id));
    }
    res.json({
      configured: isConfigured(),
      connected: false,
      realmId: null,
      companyName: null,
      connectedAt: null,
    });
  } catch (err) {
    console.error("Error disconnecting QuickBooks:", err);
    res.status(500).json({ error: "Failed to disconnect QuickBooks" });
  }
});

export default router;
