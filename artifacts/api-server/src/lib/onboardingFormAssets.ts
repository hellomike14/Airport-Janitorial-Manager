import { existsSync, readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod/v4";

const companyFormSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  owner: z.string().min(1),
  notice: z.string(),
  restricted: z.boolean(),
  filename: z.string().regex(/^[a-z0-9-]+\.pdf$/),
  version: z.string().min(1),
  pages: z.number().int().positive(),
  fieldCount: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const manifestSchema = z.object({
  company: z.string().min(1),
  protocolVersion: z.string().min(1),
  packetVersion: z.string().min(1),
  created: z.string().date(),
  forms: z.array(companyFormSchema).length(30),
});

function resolveAssetDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), "assets/onboarding-forms"),
    path.resolve(process.cwd(), "dist/assets/onboarding-forms"),
    path.resolve(process.cwd(), "artifacts/api-server/assets/onboarding-forms"),
  ];
  const directory = candidates.find(candidate => existsSync(path.join(candidate, "manifest.json")));
  if (!directory) throw new Error("Onboarding form assets are missing from the API server");
  return directory;
}

const assetDirectory = resolveAssetDirectory();
const rawManifest: unknown = JSON.parse(
  readFileSync(path.join(assetDirectory, "manifest.json"), "utf8"),
);
export const onboardingFormManifest = manifestSchema.parse(rawManifest);

if (new Set(onboardingFormManifest.forms.map(form => form.id)).size !== onboardingFormManifest.forms.length) {
  throw new Error("Onboarding form manifest contains duplicate ids");
}
for (const form of onboardingFormManifest.forms) {
  if (form.filename !== `${form.id}.pdf`) {
    throw new Error(`Onboarding form manifest has an unsafe filename for ${form.id}`);
  }
}

export const ONBOARDING_INDEX_ID = "onboarding-index";
export const ONBOARDING_INDEX_FILENAME = "Marvol_Onboarding_Forms_Index.pdf";

const indexTemplate = {
  id: ONBOARDING_INDEX_ID,
  title: "Onboarding Forms Packet - Index",
  owner: "HR / Operations",
  notice: "Index to the 30 company onboarding form templates.",
  restricted: false,
  filename: ONBOARDING_INDEX_FILENAME,
};

export type OnboardingFormTemplate =
  | (typeof onboardingFormManifest.forms)[number]
  | typeof indexTemplate;

const formsById = new Map<string, OnboardingFormTemplate>(
  onboardingFormManifest.forms.map(form => [form.id, form]),
);
formsById.set(ONBOARDING_INDEX_ID, indexTemplate);

export function getOnboardingFormTemplate(id: string): OnboardingFormTemplate | undefined {
  return formsById.get(id);
}

export function getOnboardingCompanyForms(): (typeof onboardingFormManifest.forms)[number][] {
  return onboardingFormManifest.forms;
}

export async function readOnboardingFormTemplate(id: string): Promise<Buffer> {
  const template = getOnboardingFormTemplate(id);
  if (!template) throw new Error("ONBOARDING_TEMPLATE_NOT_ALLOWLISTED");
  const absolutePath = path.resolve(assetDirectory, template.filename);
  if (!absolutePath.startsWith(`${assetDirectory}${path.sep}`)) {
    throw new Error("ONBOARDING_TEMPLATE_PATH_REJECTED");
  }
  const bytes = Buffer.from(await fs.readFile(absolutePath));
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("ONBOARDING_TEMPLATE_INVALID_PDF");
  }
  return bytes;
}
