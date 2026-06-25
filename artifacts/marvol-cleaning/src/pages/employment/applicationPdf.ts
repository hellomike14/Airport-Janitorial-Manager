import type { JobApplication } from "@workspace/api-client-react";
import {
  APPLICATION_FIELDS,
  I9_EMPLOYEE_FIELDS,
  W4_EMPLOYEE_FIELDS,
  I9_EMPLOYER_FIELDS,
  W4_EMPLOYER_FIELDS,
  type FieldDef,
} from "./formConfig";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type TFn = (key: string, opts?: any) => string;

function renderValue(field: FieldDef, value: unknown, t: TFn): string {
  if (field.type === "checkbox") return value ? t("common.yes") : t("common.no");
  if (field.type === "select" && value) {
    return t(`employment.options.${field.key}.${value}`, { defaultValue: String(value) });
  }
  return escapeHtml(value);
}

function renderSection(
  titleKey: string,
  fields: FieldDef[],
  data: Record<string, unknown>,
  t: TFn,
): string {
  const rows = fields
    .filter((f) => {
      const v = data?.[f.key];
      return v !== undefined && v !== null && v !== "";
    })
    .map(
      (f) => `
      <div style="break-inside:avoid;">
        <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(t(`employment.fields.${f.key}`))}</div>
        <div style="font-size:12px;color:#1e293b;margin-top:2px;">${renderValue(f, data[f.key], t)}</div>
      </div>`,
    )
    .join("");

  if (!rows) return "";

  return `
  <div style="margin-top:22px;break-inside:avoid;">
    <div style="font-size:12px;font-weight:700;color:#064e3b;border-bottom:2px solid #d1fae5;padding-bottom:6px;margin-bottom:12px;">${escapeHtml(t(titleKey))}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">${rows}</div>
  </div>`;
}

export function buildApplicationPDF(app: JobApplication, t: TFn): string {
  const origin = window.location.origin;
  const logoUrl = `${origin}${BASE_URL}/logo.png`;
  const logoMarkUrl = `${origin}${BASE_URL}/logo-mark.png`;
  const generatedAt = new Date().toLocaleString();

  const headerInfo = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
      <div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;">${escapeHtml(t("employment.fields.firstName"))}</div><div style="font-size:13px;color:#1e293b;font-weight:600;">${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}</div></div>
      <div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;">${escapeHtml(t("employment.fields.positionApplied"))}</div><div style="font-size:13px;color:#1e293b;">${escapeHtml(app.positionApplied || "—")}</div></div>
      ${app.email ? `<div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;">${escapeHtml(t("employment.fields.email"))}</div><div style="font-size:13px;color:#1e293b;">${escapeHtml(app.email)}</div></div>` : ""}
      ${app.phone ? `<div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;">${escapeHtml(t("employment.fields.phone"))}</div><div style="font-size:13px;color:#1e293b;">${escapeHtml(app.phone)}</div></div>` : ""}
    </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(t("employment.pdf.title"))} — ${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; color: #1e293b; }
    .page { max-width: 760px; margin: 32px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
    @media print {
      body { background: #fff; }
      .page { margin: 0; max-width: 100%; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div style="background:linear-gradient(135deg,#064e3b,#022c22);padding:24px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;">
      <div style="display:flex;align-items:center;gap:14px;">
        <img src="${logoMarkUrl}" style="width:44px;height:44px;object-fit:contain;" onerror="this.style.display='none'" />
        <div>
          <div style="background:rgba(255,255,255,0.95);border-radius:6px;padding:4px 10px;display:inline-block;">
            <img src="${logoUrl}" style="height:18px;object-fit:contain;" onerror="this.style.display='none'" />
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="color:#fff;font-weight:700;font-size:14px;">${escapeHtml(t("employment.pdf.title"))}</div>
        <div style="color:#94a3b8;font-size:10px;margin-top:3px;">${escapeHtml(t("employment.pdf.generated", { date: generatedAt }))}</div>
        <div style="color:#94a3b8;font-size:10px;margin-top:2px;">${escapeHtml(t(`employment.status.${app.status}`))}</div>
      </div>
    </div>
    <div style="padding:24px 32px 32px;">
      ${headerInfo}
      ${renderSection("employment.sections.application", APPLICATION_FIELDS, (app.application as Record<string, unknown>) ?? {}, t)}
      ${renderSection("employment.sections.i9Employee", I9_EMPLOYEE_FIELDS, (app.i9Employee as Record<string, unknown>) ?? {}, t)}
      ${renderSection("employment.sections.w4Employee", W4_EMPLOYEE_FIELDS, (app.w4Employee as Record<string, unknown>) ?? {}, t)}
      ${renderSection("employment.sections.i9Employer", I9_EMPLOYER_FIELDS, (app.i9Employer as Record<string, unknown>) ?? {}, t)}
      ${renderSection("employment.sections.w4Employer", W4_EMPLOYER_FIELDS, (app.w4Employer as Record<string, unknown>) ?? {}, t)}
      <div style="margin-top:28px;border-top:1px solid #f1f5f9;padding-top:14px;display:flex;align-items:center;gap:8px;">
        <img src="${logoMarkUrl}" style="width:20px;height:20px;object-fit:contain;opacity:0.5;" onerror="this.style.display='none'" />
        <span style="font-size:10px;color:#64748b;">${escapeHtml(t("employment.pdf.confidential"))}</span>
      </div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 500); });
  </script>
</body>
</html>`;
}
