import React, { useState, useRef } from "react";
import { format } from "date-fns";
import {
  useListIssues,
  useCreateIssue,
  useResolveIssue,
  useUpdateIssueImages,
  useListAreas,
  useListStaff,
  useAssignIssue,
  useCompleteIssue,
  useListAssignments,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertOctagon,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Camera,
  X,
  Image as ImageIcon,
  ArrowRight,
  Loader2,
  ZoomIn,
  UserCheck,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function requestPresignedUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  return res.json();
}

async function uploadFile(file: File): Promise<string> {
  const { uploadURL, objectPath } = await requestPresignedUrl(file);
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error("Upload to storage failed");
  return objectPath;
}

function imageUrl(objectPath: string) {
  return `${BASE_URL}/api/storage${objectPath}`;
}

interface ImagePickerProps {
  label: string;
  objectPath: string | null;
  onUpload: (path: string) => void;
  onRemove: () => void;
  accent?: string;
}

function ImagePicker({ label, objectPath, onUpload, onRemove, accent = "blue" }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const path = await uploadFile(file);
      onUpload(path);
    } catch (e) {
      console.error(e);
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const displaySrc = objectPath ? imageUrl(objectPath) : preview;
  const isDone = !!objectPath;

  return (
    <div className="flex-1">
      <p className="text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">{label}</p>

      {displaySrc ? (
        <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm aspect-video bg-slate-50 group cursor-pointer" onClick={() => setLightbox(true)}>
          <img src={displaySrc} alt={label} className="w-full h-full object-cover" />
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
          {isDone && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center gap-2">
              <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          {!uploading && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setPreview(null); onRemove(); }}
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 hover:bg-red-500 text-white flex items-center justify-center transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`w-full aspect-video rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all hover:border-${accent}-400 hover:bg-${accent}-50/50 border-slate-200 bg-slate-50 text-slate-400 hover:text-${accent}-500`}
        >
          <Camera className="w-6 h-6" />
          <span className="text-xs font-medium">Tap to add photo</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />

      {lightbox && displaySrc && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <button className="absolute top-4 right-4 text-white/70 hover:text-white">
            <X className="w-7 h-7" />
          </button>
          <img src={displaySrc} alt={label} className="max-w-full max-h-full rounded-xl shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function IssueImageUploader({
  issueId,
  field,
  initialPath,
  label,
  accent,
}: {
  issueId: number;
  field: "beforeImagePath" | "afterImagePath";
  initialPath: string | null;
  label: string;
  accent?: string;
}) {
  const qc = useQueryClient();
  const updateImages = useUpdateIssueImages({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/issues"] }) },
  });
  const [path, setPath] = useState<string | null>(initialPath);

  const handleUpload = (newPath: string) => {
    setPath(newPath);
    updateImages.mutate({ id: issueId, data: { [field]: newPath } as any });
  };
  const handleRemove = () => {
    setPath(null);
    updateImages.mutate({ id: issueId, data: { [field]: null } as any });
  };

  return (
    <ImagePicker label={label} objectPath={path} onUpload={handleUpload} onRemove={handleRemove} accent={accent} />
  );
}

function AssignAreaButton({
  issue,
  todayAssignments,
  assignedById,
  onAssigned,
}: {
  issue: any;
  todayAssignments: any[];
  assignedById: number;
  onAssigned: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [justAssigned, setJustAssigned] = useState(false);

  const areaStaff = todayAssignments.filter((a) => a.areaId === issue.areaId);
  const staffNames = areaStaff.map((a) => a.staffName);

  const handleAssign = async () => {
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      await fetch(`${base}/api/issues/${issue.id}/assign-area`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedById }),
      });
      setJustAssigned(true);
      onAssigned();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (staffNames.length === 0) {
    return (
      <span className="text-xs text-slate-400 italic px-2">No staff on shift</span>
    );
  }

  if (justAssigned) {
    return (
      <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">
        <UserCheck className="w-3.5 h-3.5" />
        Notified: {staffNames.join(", ")}
      </span>
    );
  }

  return (
    <button
      onClick={handleAssign}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors disabled:opacity-50 max-w-[180px] sm:max-w-none"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <UserCheck className="w-3.5 h-3.5 shrink-0" />}
      <span className="truncate">Assign → {staffNames.join(", ")}</span>
    </button>
  );
}

function StaffCompletionPanel({ issue }: { issue: any }) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const [notes, setNotes] = useState("");
  const [afterPath, setAfterPath] = useState<string | null>(issue.afterImagePath ?? null);
  const [expanded, setExpanded] = useState(false);

  const completeIssue = useCompleteIssue({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/issues"] }) },
  });
  const updateImages = useUpdateIssueImages({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/issues"] }) },
  });

  const handleAfterUpload = (path: string) => {
    setAfterPath(path);
    updateImages.mutate({ id: issue.id, data: { afterImagePath: path } });
  };

  const handleMarkDone = () => {
    completeIssue.mutate({
      id: issue.id,
      data: { completionNotes: notes || null, completedById: currentUser!.id },
    });
  };

  return (
    <div className="border-t border-amber-100 bg-amber-50/60">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-100/60 transition-colors"
      >
        <span className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4" /> Mark as Complete
        </span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-amber-900 mb-1.5 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Completion Notes <span className="text-amber-500 font-normal">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe what was done to resolve this issue..."
              className="w-full bg-white border border-amber-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 resize-none"
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-amber-900 mb-2 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" /> After Photo <span className="text-amber-500 font-normal">(optional)</span>
            </p>
            <div className="max-w-xs">
              <ImagePicker
                label=""
                objectPath={afterPath}
                onUpload={handleAfterUpload}
                onRemove={() => { setAfterPath(null); updateImages.mutate({ id: issue.id, data: { afterImagePath: null } }); }}
                accent="amber"
              />
            </div>
          </div>

          <Button
            onClick={handleMarkDone}
            disabled={completeIssue.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md shadow-emerald-600/20 font-bold"
          >
            {completeIssue.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
            ) : (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Mark Issue Done</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function SendNotificationButton({
  issueId,
  senderId,
  endpoint,
  label,
  sentLabel,
}: {
  issueId: number;
  senderId: number;
  endpoint: "send-to-supervisor" | "send-to-inspector";
  label: string;
  sentLabel: string;
}) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/issues/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, senderId }),
      });
      if (res.ok) setSent(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {sentLabel}
      </span>
    );
  }

  return (
    <button
      onClick={handleSend}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-blue-200 bg-white text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-colors disabled:opacity-50 font-semibold"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

export default function Issues() {
  const { currentUser, viewMode } = useAuth();
  const queryClient = useQueryClient();
  const [isReporting, setIsReporting] = useState(false);
  const [filterResolved, setFilterResolved] = useState<boolean | null>(false);
  const [filterTerminal, setFilterTerminal] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isStaff = viewMode === "staff";
  const isInspector = viewMode === "inspector";

  const today = format(new Date(), "yyyy-MM-dd");
  const { data: todayAssignments = [] } = useListAssignments({ date: today });

  const staffAreaId = isStaff
    ? todayAssignments.find((a) => a.staffId === currentUser?.id)?.areaId ?? null
    : null;

  const { data: issues, isLoading } = useListIssues(
    isStaff
      ? staffAreaId != null ? { areaId: staffAreaId } : {}
      : {},
    { query: { enabled: !isStaff || staffAreaId != null } }
  );
  const { data: areas } = useListAreas();
  const { data: staffList = [] } = useListStaff();

  const userId = currentUser?.id ?? 1;

  const [formData, setFormData] = useState({
    areaId: "",
    description: "",
    severity: "medium" as "low" | "medium" | "high",
  });
  const [beforePath, setBeforePath] = useState<string | null>(null);

  const createMutation = useCreateIssue({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/issues"] });
        setIsReporting(false);
        setFormData({ areaId: "", description: "", severity: "medium" });
        setBeforePath(null);
      },
    },
  });

  const resolveMutation = useResolveIssue({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/issues"] }),
    },
  });

  const areaTerminalMap = new Map<number, string>();
  areas?.forEach((a: any) => { if (a.id && a.terminal) areaTerminalMap.set(a.id, a.terminal); });
  const terminals = [...new Set(areas?.map((a: any) => a.terminal).filter(Boolean) ?? [])];

  const filteredIssues = issues?.filter((i) => {
    if (filterResolved !== null && i.resolved !== filterResolved) return false;
    if (filterTerminal && areaTerminalMap.get(i.areaId) !== filterTerminal) return false;
    return true;
  });

  const toggleExpand = (id: number) => setExpandedId(expandedId === id ? null : id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      data: {
        areaId: parseInt(formData.areaId),
        description: formData.description,
        severity: formData.severity,
        reportedById: userId,
        beforeImagePath: beforePath,
      } as any,
    });
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">
            {isStaff ? "My Area Issues" : isInspector ? "Open Issues" : "Issue Tracker"}
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            {isStaff
              ? "Open issues in your assigned area — complete them with notes and an after photo."
              : isInspector
              ? "Report issues and add information to open items across all areas."
              : "Report and monitor maintenance or cleaning issues across all areas."}
          </p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="bg-white p-1 rounded-xl border border-slate-200 flex text-sm font-medium">
            <button
              onClick={() => setFilterResolved(false)}
              className={`px-4 py-1.5 rounded-lg transition-colors ${filterResolved === false ? "bg-rose-100 text-rose-800" : "text-slate-500 hover:bg-slate-100"}`}
            >
              Open
            </button>
            <button
              onClick={() => setFilterResolved(true)}
              className={`px-4 py-1.5 rounded-lg transition-colors ${filterResolved === true ? "bg-emerald-100 text-emerald-800" : "text-slate-500 hover:bg-slate-100"}`}
            >
              Resolved
            </button>
            <button
              onClick={() => setFilterResolved(null)}
              className={`px-4 py-1.5 rounded-lg transition-colors ${filterResolved === null ? "bg-slate-200 text-slate-800" : "text-slate-500 hover:bg-slate-100"}`}
            >
              All
            </button>
          </div>

          <Button
            onClick={() => setIsReporting(!isReporting)}
            className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md shadow-rose-600/20 font-bold"
          >
            <Plus className="w-4 h-4 mr-2" /> Report Issue
          </Button>
        </div>
      </div>

      {!isStaff && terminals.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterTerminal(null)}
            className={`px-4 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
              filterTerminal === null
                ? "bg-emerald-700 text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            All Terminals
          </button>
          {terminals.map((t) => (
            <button
              key={t}
              onClick={() => setFilterTerminal(t)}
              className={`px-4 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
                filterTerminal === t
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Report Form */}
      {isReporting && (
        <div className="bg-rose-50 rounded-3xl p-6 border border-rose-100 shadow-sm">
          <h3 className="text-lg font-bold text-rose-900 mb-4 flex items-center gap-2">
            <AlertOctagon className="w-5 h-5" /> New Issue Report
          </h3>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-rose-900 mb-1">Location / Area</label>
                <select
                  required
                  value={formData.areaId}
                  onChange={(e) => setFormData({ ...formData, areaId: e.target.value })}
                  className="w-full bg-white border border-rose-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                >
                  <option value="">-- Choose Area --</option>
                  {areas?.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-rose-900 mb-1">Severity Level</label>
                <select
                  required
                  value={formData.severity}
                  onChange={(e) => setFormData({ ...formData, severity: e.target.value as any })}
                  className="w-full bg-white border border-rose-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500/20 font-medium"
                >
                  <option value="low">Low - Minor issue, normal cleaning</option>
                  <option value="medium">Medium - Needs attention soon</option>
                  <option value="high">High - Urgent maintenance/spill</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-rose-900 mb-1">Description</label>
              <textarea
                required
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the issue in detail..."
                className="w-full bg-white border border-rose-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500/20 resize-none"
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-rose-900 mb-2 flex items-center gap-2">
                <Camera className="w-4 h-4" /> Before Photo <span className="text-rose-400 font-normal">(optional)</span>
              </p>
              <div className="max-w-xs">
                <ImagePicker
                  label=""
                  objectPath={beforePath}
                  onUpload={setBeforePath}
                  onRemove={() => setBeforePath(null)}
                  accent="rose"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => { setIsReporting(false); setBeforePath(null); }} className="rounded-xl text-rose-700 hover:bg-rose-100">
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md shadow-rose-600/20 px-6 font-bold">
                {createMutation.isPending ? "Submitting..." : "Submit Report"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Empty state for staff with no shift assignment today */}
      {isStaff && staffAreaId == null && !isLoading && (
        <div className="p-12 text-center bg-slate-50 rounded-3xl border border-slate-200 border-dashed">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-3 opacity-60" />
          <h3 className="text-lg font-bold text-slate-700">No area assigned today</h3>
          <p className="text-slate-500 mt-1 text-sm">You don't have a shift assignment for today. Contact your supervisor.</p>
        </div>
      )}

      {/* Empty state for staff with area but no issues */}
      {isStaff && staffAreaId != null && !isLoading && filteredIssues?.length === 0 && filterResolved === false && (
        <div className="p-12 text-center bg-emerald-50 rounded-3xl border border-emerald-100 border-dashed">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-60" />
          <h3 className="text-lg font-bold text-emerald-700">No open issues in your area</h3>
          <p className="text-emerald-600 mt-1 text-sm">Your area is clear. A supervisor will notify you if any issues come up.</p>
        </div>
      )}

      {/* Issue list */}
      <div className="space-y-4">
        {isLoading && (
          <div className="p-8 text-center text-slate-500 animate-pulse bg-white rounded-3xl">Loading issues...</div>
        )}

        {filteredIssues?.map((issue) => {
          const isExpanded = expandedId === issue.id;
          const hasImages = issue.beforeImagePath || issue.afterImagePath;
          const isMyAssignedIssue = isStaff && !issue.resolved;

          return (
            <div
              key={issue.id}
              className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                issue.resolved
                  ? "bg-slate-50 border-slate-200 opacity-80"
                  : issue.severity === "high"
                  ? "bg-white border-rose-200 shadow-md shadow-rose-100"
                  : "bg-white border-slate-200 shadow-sm hover:border-slate-300"
              }`}
            >
              {/* Main row */}
              <div className="p-5 flex flex-col sm:flex-row gap-4 sm:items-start">
                <div className="shrink-0 mt-0.5">
                  {issue.resolved ? (
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                  ) : issue.severity === "high" ? (
                    <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center animate-pulse">
                      <AlertOctagon className="w-6 h-6" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-slate-900">{issue.areaName}</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-sm text-slate-500">{format(new Date(issue.createdAt), "MMM do, h:mm a")}</span>
                    {hasImages && (
                      <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        <ImageIcon className="w-3 h-3" />
                        {[issue.beforeImagePath, issue.afterImagePath].filter(Boolean).length} photo{[issue.beforeImagePath, issue.afterImagePath].filter(Boolean).length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className={`text-base ${issue.resolved ? "text-slate-500 line-through" : "text-slate-700"}`}>
                    {issue.description}
                  </p>

                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-400">
                    <span className="font-medium uppercase tracking-wider">By: {issue.reportedByName}</span>
                    {issue.assignedToName && (
                      <span className="flex items-center gap-1 text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                        <UserCheck className="w-3 h-3" /> Assigned: {issue.assignedToName}
                      </span>
                    )}
                    {issue.resolved && issue.completionNotes && (
                      <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <MessageSquare className="w-3 h-3" /> "{issue.completionNotes}"
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex flex-row sm:flex-col items-center sm:items-end gap-3 justify-between">
                  <StatusBadge
                    status={issue.resolved ? "success" : issue.severity === "high" ? "danger" : issue.severity === "medium" ? "warning" : "neutral"}
                    className="uppercase !text-[10px] tracking-wider"
                  >
                    {issue.resolved ? "Resolved" : `${issue.severity} Priority`}
                  </StatusBadge>

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Assign to area staff — supervisors/admin only */}
                    {!isStaff && !isInspector && !issue.resolved && (
                      <AssignAreaButton
                        issue={issue}
                        todayAssignments={todayAssignments}
                        assignedById={userId}
                        onAssigned={() => queryClient.invalidateQueries({ queryKey: ["/api/issues"] })}
                      />
                    )}

                    {isInspector && !issue.resolved && (
                      <SendNotificationButton
                        issueId={issue.id}
                        senderId={userId}
                        endpoint="send-to-supervisor"
                        label="Send to Supervisor"
                        sentLabel="Sent"
                      />
                    )}

                    {!isStaff && !isInspector && issue.resolved && (
                      <SendNotificationButton
                        issueId={issue.id}
                        senderId={userId}
                        endpoint="send-to-inspector"
                        label="Notify Inspector"
                        sentLabel="Sent"
                      />
                    )}

                    <button
                      onClick={() => toggleExpand(issue.id)}
                      className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Photos
                    </button>

                    {!isStaff && !isInspector && !issue.resolved && (
                      <Button
                        onClick={() => {
                          if (confirm("Mark this issue as resolved?")) {
                            resolveMutation.mutate({ id: issue.id });
                          }
                        }}
                        disabled={resolveMutation.isPending}
                        variant="outline"
                        className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 text-xs h-8 px-3"
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Resolve
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Expandable photo section */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-5 py-5 bg-slate-50/60">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <Camera className="w-3.5 h-3.5" /> Issue Photos
                  </p>
                  <div className="flex gap-4 items-start">
                    <IssueImageUploader
                      issueId={issue.id}
                      field="beforeImagePath"
                      initialPath={issue.beforeImagePath ?? null}
                      label="Before Photo"
                      accent="blue"
                    />

                    <div className="flex items-center self-center shrink-0 text-slate-300 mt-4">
                      <ArrowRight className="w-5 h-5" />
                    </div>

                    <IssueImageUploader
                      issueId={issue.id}
                      field="afterImagePath"
                      initialPath={issue.afterImagePath ?? null}
                      label="After Photo"
                      accent="emerald"
                    />
                  </div>
                </div>
              )}

              {/* Staff completion panel */}
              {isMyAssignedIssue && (
                <StaffCompletionPanel issue={issue} />
              )}
            </div>
          );
        })}

        {(!filteredIssues || filteredIssues.length === 0) && !isLoading && !(isStaff && filterResolved === false) && (
          <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-50" />
            <h3 className="text-lg font-bold text-slate-700">All Clear!</h3>
            <p className="text-slate-500 mt-1">No issues matching this filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}
