import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Upload, X, Loader2, FileText } from "lucide-react";
import { useSubmitApplication } from "@workspace/api-client-react";
import type { UploadedDocument } from "@workspace/api-client-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PUBLIC_SECTIONS } from "./employment/formConfig";
import { FieldGrid } from "./employment/FormField";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function uploadFile(file: File): Promise<UploadedDocument> {
  const res = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
      purpose: "application-document",
    }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  const { uploadURL, objectPath } = await res.json();
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error("Upload failed");
  return { name: file.name, path: objectPath, contentType: file.type };
}

export default function Apply() {
  const { t } = useTranslation();
  const submit = useSubmitApplication();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [positionApplied, setPositionApplied] = useState("");

  const [groups, setGroups] = useState<Record<string, Record<string, unknown>>>({
    application: {},
    i9Employee: {},
    w4Employee: {},
  });
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const setField = (group: string) => (key: string, value: unknown) =>
    setGroups((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(Array.from(files).map(uploadFile));
      setDocuments((prev) => [...prev, ...uploaded]);
    } catch {
      setError(t("employment.apply.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError(t("employment.apply.nameRequired"));
      return;
    }
    try {
      await submit.mutateAsync({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          positionApplied: positionApplied.trim() || null,
          application: groups.application,
          i9Employee: groups.i9Employee,
          w4Employee: groups.w4Employee,
          documents,
        },
      });
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError(t("employment.apply.submitError"));
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-5">
            <CheckCircle2 className="w-9 h-9 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            {t("employment.apply.confirmTitle")}
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            {t("employment.apply.confirmBody")}
          </p>
        </div>
      </div>
    );
  }

  const labelCls = "block text-xs font-medium text-slate-600 mb-1";
  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white">
        <div className="max-w-3xl mx-auto px-4 py-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src={`${BASE_URL}/logo-mark.png`}
              alt=""
              className="w-12 h-12 object-contain"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t("employment.apply.title")}
              </h1>
              <p className="text-emerald-200/80 text-sm mt-0.5">
                {t("employment.apply.subtitle")}
              </p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Applicant identity */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1">
            {t("employment.sections.applicant")}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            {t("employment.sections.applicantDesc")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className={labelCls}>{t("employment.fields.firstName")} *</label>
              <input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>{t("employment.fields.lastName")} *</label>
              <input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>{t("employment.fields.email")}</label>
              <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t("employment.fields.phone")}</label>
              <input type="tel" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>{t("employment.fields.positionApplied")}</label>
              <input className={inputCls} value={positionApplied} onChange={(e) => setPositionApplied(e.target.value)} />
            </div>
          </div>
        </section>

        {/* Grouped form sections */}
        {PUBLIC_SECTIONS.map((section) => (
          <section key={section.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              {t(`employment.sections.${section.id}`)}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {t(`employment.sections.${section.id}Desc`)}
            </p>
            <FieldGrid
              fields={section.fields}
              values={groups[section.group]}
              onChange={setField(section.group)}
            />
          </section>
        ))}

        {/* Documents */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1">
            {t("employment.sections.documents")}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            {t("employment.sections.documentsDesc")}
          </p>

          {documents.length > 0 && (
            <ul className="mb-4 space-y-2">
              {documents.map((doc, i) => (
                <li
                  key={`${doc.path}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                >
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="flex-1 truncate text-slate-700">{doc.name}</span>
                  <button
                    type="button"
                    onClick={() => setDocuments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-8 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors">
            {uploading ? (
              <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
            ) : (
              <Upload className="w-6 h-6 text-slate-400" />
            )}
            <span className="text-sm text-slate-500">{t("employment.apply.uploadPrompt")}</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              disabled={uploading}
            />
          </label>
        </section>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submit.isPending || uploading}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
          >
            {submit.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("employment.apply.submitButton")}
          </button>
        </div>
      </form>
    </div>
  );
}
