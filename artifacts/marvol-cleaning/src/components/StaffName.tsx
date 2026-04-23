import { useTranslation } from "react-i18next";

const FORMER_SUFFIX_RE = /\s*\(former\)\s*$/i;

export function isFormerStaff(name?: string | null, active?: boolean | null): boolean {
  if (active === false) return true;
  if (typeof name === "string" && FORMER_SUFFIX_RE.test(name)) return true;
  return false;
}

export function stripFormerSuffix(name?: string | null): string {
  if (!name) return "";
  return name.replace(FORMER_SUFFIX_RE, "");
}

type StaffNameProps = {
  name?: string | null;
  active?: boolean | null;
  className?: string;
  badgeClassName?: string;
  showBadge?: boolean;
};

export function StaffName({
  name,
  active,
  className = "",
  badgeClassName = "",
  showBadge = true,
}: StaffNameProps) {
  const { t } = useTranslation();
  if (!name) return null;
  const former = isFormerStaff(name, active);
  const displayName = stripFormerSuffix(name);

  if (!former) {
    return <span className={className}>{displayName}</span>;
  }

  return (
    <span className={`${className} text-slate-400 italic`}>
      {displayName}
      {showBadge && (
        <span
          className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500 not-italic ${badgeClassName}`}
        >
          {t("common.former", "Former")}
        </span>
      )}
    </span>
  );
}
