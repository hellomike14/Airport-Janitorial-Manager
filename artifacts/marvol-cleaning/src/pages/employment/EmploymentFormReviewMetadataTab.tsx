import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  getListEmploymentFormSubmissionsQueryKey,
  useListEmploymentFormSubmissions,
  useUpdateEmploymentFormSubmissionReview,
} from "@workspace/api-client-react";
import type { EmploymentFormId } from "./formEditor/formSources";
import { getOnboardingForm } from "./onboardingFormCatalog";

type ReviewStatus = "pending" | "reviewed" | "needs_follow_up";

function formTitle(formId: EmploymentFormId, t: (key: string) => string) {
  if (formId === "i-9") return t("employment.forms.i9");
  if (formId === "w-4") return t("employment.forms.w4");
  if (formId === "job-application") return t("employment.forms.jobApplication");
  return getOnboardingForm(formId)?.title ?? "Marvol onboarding form";
}

export function EmploymentFormReviewMetadataTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = getListEmploymentFormSubmissionsQueryKey();
  const { data, isLoading, isError } = useListEmploymentFormSubmissions({
    query: { queryKey, refetchOnMount: "always" },
  });
  const updateReview = useUpdateEmploymentFormSubmissionReview({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" data-testid="employee-form-review-metadata">
      <h2 className="text-lg font-semibold text-slate-900">{t("employment.submittedForms.title")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("employment.reviewMetadata.description", "Review submission details and update their status. Submitted files and identity photos remain Admin-only.")}
      </p>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : isError ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {t("employment.submittedForms.loadError")}
        </p>
      ) : !data?.length ? (
        <p className="py-12 text-center text-sm text-slate-500">{t("employment.submittedForms.empty")}</p>
      ) : (
        <div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {data.map((submission) => (
            <div key={submission.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">
                  {submission.firstName} {submission.lastName} · {formTitle(submission.formId, t)}
                </p>
                <p className="mt-1 break-all text-sm text-slate-500">
                  {submission.email}{submission.phone ? ` · ${submission.phone}` : ""}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(submission.submittedAt).toLocaleDateString()}
                  {submission.reviewedAt && (
                    <> · {t("employment.reviewMetadata.reviewedBy", "Reviewed by {{name}}", {
                      name: submission.reviewedByName ?? t("employment.reviewMetadata.unknownReviewer", "another administrator"),
                    })} {new Date(submission.reviewedAt).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <label className="flex shrink-0 flex-col gap-1 text-xs font-medium text-slate-600">
                <span>{t("employment.reviewMetadata.status", "Review status")}</span>
                <select
                  aria-label={t("employment.reviewMetadata.statusFor", "Review status for {{name}}", {
                    name: `${submission.firstName} ${submission.lastName}`,
                  })}
                  value={submission.reviewStatus}
                  disabled={updateReview.isPending}
                  onChange={(event) => updateReview.mutate({
                    id: submission.id,
                    data: { reviewStatus: event.target.value as ReviewStatus },
                  })}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 disabled:opacity-60"
                >
                  <option value="pending">{t("employment.reviewMetadata.pending", "Pending review")}</option>
                  <option value="reviewed">{t("employment.reviewMetadata.reviewed", "Reviewed")}</option>
                  <option value="needs_follow_up">{t("employment.reviewMetadata.followUp", "Needs follow-up")}</option>
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
      {updateReview.isError && (
        <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("employment.reviewMetadata.updateError", "Could not update the review status. Try again.")}
        </p>
      )}
    </section>
  );
}
