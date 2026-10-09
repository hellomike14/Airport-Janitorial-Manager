const base = import.meta.env.BASE_URL || "/";

export function MarvolOperationsBrandHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="flex items-center gap-4 border-b border-emerald-100 pb-4">
      <img
        src={`${base}logo-mark.png`}
        alt="Marvol Facility Services"
        className="h-12 w-12 shrink-0 object-contain"
      />
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">
          Marvol Facility Services
        </p>
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
    </header>
  );
}
