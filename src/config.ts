import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const booleanText = z
  .string()
  .optional()
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://airport:airport@localhost:5432/airport_manager"),
  DB_SSL: booleanText,
  ADMIN_PASSWORD: z.string().min(12).default("local-development-password"),
  SESSION_SECRET: z
    .string()
    .min(24)
    .default("local-development-session-secret-change-me"),
  CRON_SECRET: z
    .string()
    .min(24)
    .default("local-development-cron-secret-change-me"),
  OPERATIONS_TIMEZONE: z.string().default("America/New_York"),
  INTERNAL_RESPONSE_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  WEEKDAY_SUPERVISOR_NAME: z.string().min(1).default("Priscilla"),
  WEEKDAY_SUPERVISOR_EMAIL: z.email().default("priscilla@example.com"),
  WEEKEND_SUPERVISOR_NAME: z.string().min(1).default("Ronaldo"),
  WEEKEND_SUPERVISOR_EMAIL: z.email().default("ronaldo@example.com"),
  ESCALATION_EMAILS: z.string().default(""),
  ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(25 * 1024 * 1024)
    .default(10 * 1024 * 1024),

  MICROSOFT_TENANT_ID: optionalText,
  MICROSOFT_CLIENT_ID: optionalText,
  MICROSOFT_CLIENT_SECRET: optionalText,
  MICROSOFT_MAILBOX: optionalText,
  GRAPH_WEBHOOK_CLIENT_STATE: optionalText,

  TRANSLATION_PROVIDER: z
    .enum(["auto", "openai", "azure", "none"])
    .default("auto"),
  OPENAI_API_KEY: optionalText,
  OPENAI_TRANSLATION_MODEL: z.string().default("gpt-4.1-mini"),
  AZURE_TRANSLATOR_KEY: optionalText,
  AZURE_TRANSLATOR_REGION: optionalText,
  AZURE_TRANSLATOR_ENDPOINT: z
    .url()
    .default("https://api.cognitive.microsofttranslator.com"),
});

const parsed = envSchema.parse(process.env);

const unsafeDefaults = [
  "local-development-password",
  "local-development-session-secret-change-me",
  "local-development-cron-secret-change-me",
];

if (
  parsed.NODE_ENV === "production" &&
  unsafeDefaults.some((value) =>
    [parsed.ADMIN_PASSWORD, parsed.SESSION_SECRET, parsed.CRON_SECRET].includes(value),
  )
) {
  throw new Error(
    "Production cannot start with the local ADMIN_PASSWORD, SESSION_SECRET, or CRON_SECRET defaults.",
  );
}

export const config = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  appUrl: parsed.APP_URL.replace(/\/$/, ""),
  databaseUrl: parsed.DATABASE_URL,
  dbSsl: parsed.DB_SSL,
  adminPassword: parsed.ADMIN_PASSWORD,
  sessionSecret: parsed.SESSION_SECRET,
  cronSecret: parsed.CRON_SECRET,
  timezone: parsed.OPERATIONS_TIMEZONE,
  responseMinutes: parsed.INTERNAL_RESPONSE_MINUTES,
  attachmentMaxBytes: parsed.ATTACHMENT_MAX_BYTES,
  supervisors: {
    timezone: parsed.OPERATIONS_TIMEZONE,
    weekdayName: parsed.WEEKDAY_SUPERVISOR_NAME,
    weekdayEmail: parsed.WEEKDAY_SUPERVISOR_EMAIL,
    weekendName: parsed.WEEKEND_SUPERVISOR_NAME,
    weekendEmail: parsed.WEEKEND_SUPERVISOR_EMAIL,
  },
  escalationEmails: parsed.ESCALATION_EMAILS.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  microsoft: {
    tenantId: parsed.MICROSOFT_TENANT_ID,
    clientId: parsed.MICROSOFT_CLIENT_ID,
    clientSecret: parsed.MICROSOFT_CLIENT_SECRET,
    mailbox: parsed.MICROSOFT_MAILBOX?.toLowerCase(),
    webhookClientState: parsed.GRAPH_WEBHOOK_CLIENT_STATE,
  },
  translation: {
    provider: parsed.TRANSLATION_PROVIDER,
    openAiKey: parsed.OPENAI_API_KEY,
    openAiModel: parsed.OPENAI_TRANSLATION_MODEL,
    azureKey: parsed.AZURE_TRANSLATOR_KEY,
    azureRegion: parsed.AZURE_TRANSLATOR_REGION,
    azureEndpoint: parsed.AZURE_TRANSLATOR_ENDPOINT.replace(/\/$/, ""),
  },
} as const;
