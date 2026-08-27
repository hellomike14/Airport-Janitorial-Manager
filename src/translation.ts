import { config } from "./config.js";

export type TranslationStatus = "COMPLETED" | "FAILED" | "SKIPPED";

export interface TranslationResult {
  text: string;
  status: TranslationStatus;
  provider: "openai" | "azure" | "none";
  error?: string;
}

function selectedProvider(): "openai" | "azure" | "none" {
  const selected = config.translation.provider;
  if (selected === "none") return "none";
  if (selected === "openai") return "openai";
  if (selected === "azure") return "azure";
  if (config.translation.azureKey) return "azure";
  if (config.translation.openAiKey) return "openai";
  return "none";
}

function languageName(code: "en" | "es"): string {
  return code === "en" ? "English" : "Spanish";
}

async function translateWithOpenAi(
  text: string,
  from: "en" | "es",
  to: "en" | "es",
): Promise<string> {
  if (!config.translation.openAiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.translation.openAiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.translation.openAiModel,
      instructions:
        `Translate the user's message from ${languageName(from)} to ${languageName(to)}. ` +
        "Preserve names, airport locations, gate numbers, times, urgency, and formatting. " +
        "Return only the translation. Do not summarize, soften, or add commentary.",
      input: text,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`OpenAI translation failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (payload.output_text?.trim()) return payload.output_text.trim();

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text?.trim()) {
        return content.text.trim();
      }
    }
  }

  throw new Error("OpenAI returned no translated text.");
}

async function translateWithAzure(
  text: string,
  from: "en" | "es",
  to: "en" | "es",
): Promise<string> {
  if (!config.translation.azureKey || !config.translation.azureRegion) {
    throw new Error(
      "AZURE_TRANSLATOR_KEY and AZURE_TRANSLATOR_REGION are required.",
    );
  }

  const url = new URL("/translate", config.translation.azureEndpoint);
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.translation.azureKey,
      "Ocp-Apim-Subscription-Region": config.translation.azureRegion,
      "content-type": "application/json",
    },
    body: JSON.stringify([{ text }]),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Azure translation failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as Array<{
    translations?: Array<{ text?: string }>;
  }>;
  const translated = payload[0]?.translations?.[0]?.text?.trim();

  if (!translated) throw new Error("Azure returned no translated text.");
  return translated;
}

export async function translate(
  text: string,
  from: "en" | "es",
  to: "en" | "es",
): Promise<TranslationResult> {
  const clean = text.trim();
  const provider = selectedProvider();

  if (!clean) {
    return { text: "", status: "SKIPPED", provider };
  }

  if (provider === "none") {
    return {
      text: clean,
      status: "SKIPPED",
      provider,
      error: "No translation provider is configured.",
    };
  }

  try {
    const translated =
      provider === "openai"
        ? await translateWithOpenAi(clean, from, to)
        : await translateWithAzure(clean, from, to);

    return { text: translated, status: "COMPLETED", provider };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown translation error";
    console.error("Translation error", { provider, message });
    return {
      text: clean,
      status: "FAILED",
      provider,
      error: message,
    };
  }
}
