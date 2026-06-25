import { useTranslation } from "react-i18next";
import type { FieldDef } from "./formConfig";

interface FormFieldProps {
  field: FieldDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

export function FormField({ field, value, onChange, disabled }: FormFieldProps) {
  const { t } = useTranslation();
  const label = t(`employment.fields.${field.key}`);
  const id = `f-${field.key}`;

  const baseInput =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500";

  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2.5 py-1.5 cursor-pointer select-none">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
    );
  }

  const labelEl = (
    <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
      {label}
    </label>
  );

  if (field.type === "textarea") {
    return (
      <div>
        {labelEl}
        <textarea
          id={id}
          rows={3}
          disabled={disabled}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={baseInput}
        />
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        {labelEl}
        <select
          id={id}
          disabled={disabled}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={baseInput}
        >
          <option value="">{t("employment.selectPlaceholder")}</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {t(`employment.options.${field.key}.${opt}`)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const inputType =
    field.type === "ssn"
      ? "text"
      : field.type === "number"
        ? "number"
        : field.type;

  return (
    <div>
      {labelEl}
      <input
        id={id}
        type={inputType}
        disabled={disabled}
        value={(value as string | number) ?? ""}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={baseInput}
      />
    </div>
  );
}

export function FieldGrid({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
      {fields.map((field) => {
        const span =
          field.type === "textarea" ||
          field.type === "checkbox" ||
          !field.half
            ? "sm:col-span-2"
            : "";
        return (
          <div key={field.key} className={span}>
            <FormField
              field={field}
              value={values?.[field.key]}
              onChange={onChange}
              disabled={disabled}
            />
          </div>
        );
      })}
    </div>
  );
}
