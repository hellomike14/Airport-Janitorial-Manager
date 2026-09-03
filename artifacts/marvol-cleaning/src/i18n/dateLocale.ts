import { enUS, es, fr } from "date-fns/locale";
import type { Locale } from "date-fns";

const DATE_LOCALES: Record<string, Locale> = {
  en: enUS,
  es: es,
  fr: fr,
};

export function getDateLocale(lang: string): Locale {
  const baseLang = lang.split("-")[0].split("_")[0];
  return DATE_LOCALES[baseLang] ?? enUS;
}
