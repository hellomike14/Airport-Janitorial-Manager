import React, { useState, useRef } from "react";
import { format } from "date-fns";
import {
  useListIssues,
  useCreateIssue,
  useResolveIssue,
  useUpdateIssueImages,
  useListAreas,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertOctagon,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Camera,
  Upload,
  X,
  Image as ImageIcon,
  ArrowRight,
  Loader2,
  ZoomIn,
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

export default function Issues() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [isReporting, setIsReporting] = useState(false);
  const [filterResolved, setFilterResolved] = useState<boolean | null>(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: issues, isLoading } = useListIssues();
  const { data: areas } = useListAreas();

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

  const filteredIssues = issues?.filter((i) => {
    if (filterResolved === null) return true;
    return i.resolved === filterResolved;
  });

  const toggleExpand = (id: number) => setExpandedId(expandedId === id ? null : id);

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Issue Tracker</h1>
          <p className="text-slate-500 mt-1 font-medium">Report and monitor maintenance or cleaning issues.</p>
        </div>

        <div className="flex gap-3">
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

            {/* Before photo */}
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

            <div className="flex justify-end gap-3 pt-2">
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

      {/* Issue list */}
      <div className="space-y-4">
        {isLoading && (
          <div className="p-8 text-center text-slate-500 animate-pulse bg-white rounded-3xl">Loading issues...</div>
        )}

        {filteredIssues?.map((issue) => {
          const isExpanded = expandedId === issue.id;
          const hasImages = issue.beforeImagePath || issue.afterImagePath;

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
              <div className="p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
                <div className="shrink-0">
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
                    <span className="text-sm text-slate-500">{format(new Date(issue.issueDate), "MMM do, h:mm a")}</span>
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
                  <p className="text-xs text-slate-400 mt-1.5 font-medium uppercase tracking-wider">
                    Reported by: {issue.reportedByName}
                  </p>
                </div>

                <div className="shrink-0 flex flex-row sm:flex-col items-center sm:items-end gap-3 justify-between">
                  <StatusBadge
                    status={issue.resolved ? "success" : issue.severity === "high" ? "danger" : issue.severity === "medium" ? "warning" : "neutral"}
                    className="uppercase !text-[10px] tracking-wider"
                  >
                    {issue.resolved ? "Resolved" : `${issue.severity} Priority`}
                  </StatusBadge>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleExpand(issue.id)}
                      className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Photos
                    </button>

                    {!issue.resolved && (
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
            </div>
          );
        })}

        {(!filteredIssues || filteredIssues.length === 0) && !isLoading && (
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
