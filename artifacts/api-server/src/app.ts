import express, { type Express, type Request } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
  getClerkProxyProtocol,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";

const app: Express = express();

function normalizeWebOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function configuredCorsOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of value?.split(",") ?? []) {
    if (!entry.trim()) continue;
    const origin = normalizeWebOrigin(entry);
    if (!origin) {
      throw new Error(
        `Invalid CORS_ALLOWED_ORIGINS entry "${entry.trim()}"; expected an explicit http(s) origin.`,
      );
    }
    origins.add(origin);
  }
  return origins;
}

function publicRequestOrigin(req: Request): string | null {
  const host = getClerkProxyHost(req);
  const protocol = getClerkProxyProtocol(req);
  return host && protocol ? `${protocol}://${host}` : null;
}

const allowedCorsOrigins = configuredCorsOrigins(process.env.CORS_ALLOWED_ORIGINS);
const credentialedCors = cors({ credentials: true, origin: true });

// Same-origin requests remain the default. Cross-origin browser access must be
// explicitly listed; arbitrary origins must never be reflected with cookies.
app.use((req, res, next) => {
  const rawOrigin = req.header("origin");
  if (!rawOrigin) {
    next();
    return;
  }

  const origin = normalizeWebOrigin(rawOrigin);
  const allowed =
    origin !== null &&
    (origin === publicRequestOrigin(req) || allowedCorsOrigins.has(origin));
  if (!allowed) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  credentialedCors(req, res, next);
});

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
