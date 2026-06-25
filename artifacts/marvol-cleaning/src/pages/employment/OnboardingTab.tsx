import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, UserPlus, ClipboardCheck } from "lucide-react";
import {
  useListOnboardingHires,
  useCreateOnboardingHire,
  useDeleteOnboardingHire,
  useUpdateOnboardingItem,
  getListOnboardingHiresQueryKey,
} from "@workspace/api-client-react";
import type { OnboardingHire, OnboardingItem } from "@workspace/api-client-react";

const CATEGORY_ORDER = ["step", "document", "training", "walkthrough"] as const;

function HireCard({ hire }: { hire: OnboardingHire }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const updateItem = useUpdateOnboardingItem();
  const deleteHire = useDeleteOnboardingHire();

  const items = hire.items ?? [];
  const total = hire.totalItems ?? items.length;
  const completed = hire.completedItems ?? items.filter((i) => i.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListOnboardingHiresQueryKey() });

  const toggle = async (item: OnboardingItem) => {
    await updateItem.mutateAsync({
      itemId: item.id,
      data: { completed: !item.completed },
    });
    invalidate();
  };

  const remove = async () => {
    if (!window.confirm(t("employment.onboarding.confirmDelete"))) return;
    await deleteHire.mutateAsync({ id: hire.id });
    invalidate();
  };

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: items.filter((i) => i.category === cat).sort((a, b) => a.sortOrder - b.sortOrder),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{hire.name}</h3>
          {hire.position && <p className="text-sm text-slate-500">{hire.position}</p>}
        </div>
        <button onClick={remove} className="text-slate-400 hover:text-red-500 p-1">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="mb-5">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>{t("employment.onboarding.progress")}</span>
          <span>
            {completed}/{total} · {pct}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="space-y-4">
        {byCategory.map(({ cat, items: catItems }) => (
          <div key={cat}>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              {t(`employment.onboarding.categories.${cat}`)}
            </div>
            <ul className="space-y-1.5">
              {catItems.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => toggle(item)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span
                      className={`text-sm ${item.completed ? "text-slate-400 line-through" : "text-slate-700"}`}
                    >
                      {item.title}
                      {item.description && (
                        <span className="block text-xs text-slate-400">{item.description}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OnboardingTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: hires, isLoading } = useListOnboardingHires();
  const createHire = useCreateOnboardingHire();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createHire.mutateAsync({
      data: { name: name.trim(), position: position.trim() || null },
    });
    await queryClient.invalidateQueries({ queryKey: getListOnboardingHiresQueryKey() });
    setName("");
    setPosition("");
    setShowForm(false);
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{t("employment.onboarding.subtitle")}</p>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="w-4 h-4" />
          {t("employment.onboarding.addHire")}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-5 flex flex-col sm:flex-row gap-3 sm:items-end"
        >
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t("employment.fields.firstName")} / {t("employment.fields.lastName")}
            </label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t("employment.fields.positionApplied")}
            </label>
            <input className={inputCls} value={position} onChange={(e) => setPosition(e.target.value)} />
          </div>
          <button
            type="submit"
            disabled={createHire.isPending || !name.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {createHire.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {t("common.save")}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      ) : !hires || hires.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{t("employment.onboarding.empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {hires.map((hire) => (
            <HireCard key={hire.id} hire={hire} />
          ))}
        </div>
      )}
    </div>
  );
}
