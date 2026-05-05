import { useTranslation } from "react-i18next";

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
  const former = active === false;

  if (!former) {
    return <span className={className}>{name}</span>;
  }

  return (
    <span className={`${className} text-slate-400 italic`}>
      {name}
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
