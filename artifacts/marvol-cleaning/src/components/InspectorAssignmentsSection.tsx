import { format } from "date-fns";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import type { InspectorAssignmentReport } from "@workspace/api-client-react";
import { InspectorWorkflowCard } from "@/components/InspectorWorkflowCard";
import { TaskPhotoThumbnails } from "@/components/TaskPhotos";
import { useAuth } from "@/contexts/AuthContext";
import { sourceMessageHref } from "@/lib/inspectorAssignmentLinks";

export function InspectorAssignmentsSection({
  assignments,
  isLoading,
  isError,
  highlightedTaskId = null,
}: {
  assignments: InspectorAssignmentReport[];
  isLoading: boolean;
  isError: boolean;
  highlightedTaskId?: number | null;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const canViewSourceMessages = ["admin", "supervisor", "inspector"].includes(currentUser?.role ?? "");

  return (
    <section className="space-y-4" aria-labelledby="inspector-special-assignments-title">
      <div>
        <h2 id="inspector-special-assignments-title" className="text-xl font-bold text-slate-900">
          {t("inspectorAssignments.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("inspectorAssignments.subtitle")}</p>
      </div>

      {isLoading && (
        <p role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          {t("inspectorAssignments.loading")}
        </p>
      )}
      {isError && !isLoading && (
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          {t("inspectorAssignments.loadError")}
        </p>
      )}
      {!isLoading && !isError && assignments.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
          {t("inspectorAssignments.empty")}
        </p>
      )}

      <div className="space-y-4">
        {assignments.map((assignment) => {
          const receivedAt = new Date(assignment.sourceEmail.receivedAt);

          return (
            <article
              key={assignment.task.id}
              id={`inspector-assignment-${assignment.task.id}`}
              data-testid={`inspector-assignment-${assignment.task.id}`}
              className={`rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5 ${
                highlightedTaskId === assignment.task.id ? "ring-2 ring-amber-500 shadow-lg" : ""
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    {assignment.area.terminal} · {assignment.area.name}
                  </p>
                  <h3 className="mt-1 text-base font-bold text-slate-900">{assignment.task.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("inspectorAssignments.taskDate")}: {assignment.task.taskDate}
                    {" · "}
                    {t("inspectorAssignments.assignedTo")}: {assignment.assignedStaff?.name ?? t("inspectorAssignments.awaitingAssignment")}
                  </p>
                </div>
                {canViewSourceMessages && (
                  <Link
                    href={sourceMessageHref(assignment.source.conversationId, assignment.source.messageId)}
                    className="no-print inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-50"
                  >
                    {t("inspectorAssignments.viewSource")}
                  </Link>
                )}
              </div>

              <InspectorWorkflowCard
                taskId={assignment.task.id}
                workflowData={assignment}
                showDeliveryStatus={false}
              />

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                <span>{t("inspectorAssignments.dueAt")}: {format(new Date(assignment.dueAt), "PPpp")}</span>
                {assignment.task.completedAt && (
                  <span className="font-semibold text-emerald-700">
                    {t("inspectorAssignments.completedAt")}: {format(new Date(assignment.task.completedAt), "PPpp")}
                  </span>
                )}
              </div>

              {assignment.task.taskNotes && (
                <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold">{t("inspectorAssignments.taskNotes")}: </span>
                  {assignment.task.taskNotes}
                </p>
              )}

              {(assignment.task.beforeImagePath || assignment.task.afterImagePath) && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("inspectorAssignments.taskPhotos")}
                  </p>
                  <TaskPhotoThumbnails
                    beforeImagePath={assignment.task.beforeImagePath}
                    afterImagePath={assignment.task.afterImagePath}
                  />
                </div>
              )}

              <details open className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  {t("inspectorAssignments.sourceEmail")}
                </summary>
                <div className="mt-3 space-y-2 text-sm">
                  <p className="text-xs text-slate-600">
                    {t("inspectorAssignments.sender")}: {assignment.sourceEmail.senderEmail ?? t("inspectorAssignments.unavailable")}
                    {" · "}
                    {t("inspectorAssignments.receivedAt")}: {format(receivedAt, "PPpp")}
                  </p>
                  {assignment.sourceEmail.subject && (
                    <p><span className="font-semibold">{t("inspectorAssignments.subject")}: </span>{assignment.sourceEmail.subject}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-slate-700">
                    {assignment.sourceEmail.body ?? assignment.sourceEmail.storedMessageBody}
                  </p>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
