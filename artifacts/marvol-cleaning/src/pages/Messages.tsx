import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  MessageSquare,
  Plus,
  Send,
  ArrowLeft,
  Shield,
  Users,
  User,
  X,
  Users2,
  ClipboardList,
  ChevronRight,
  Trash2,
  Pencil,
  Archive,
  ArchiveRestore,
  AlertTriangle,
  Mail,
  Camera,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { InspectorWorkflowCard } from "@/components/InspectorWorkflowCard";
import { MessageReceiptStatus } from "@/components/MessageReceiptStatus";
import { trackEvent } from "@/lib/analytics";
import humanTraffickingFlyer from "@assets/MCO_Human_Trafficing_1787144155521.jpeg";
import {
  listConversations,
  listConversationMessages,
  startConversation,
  startGroupConversation,
  sendConversationMessage,
  markConversationRead,
  deleteConversationMessage,
  deleteOldConversationMessages,
  updateConversationMessage,
  setConversationArchive,
  listStaff,
  listArchivedConversations,
  listInspectorEmailRecipients,
  confirmConversationMessageReceipt,
  requestUploadUrl,
  type ConversationSummary,
} from "@workspace/api-client-react";

const CONVERSATIONS_KEY = "/api/conversations";
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function uploadConversationPhoto(
  file: File,
  conversationId: number,
  onProgress: (progress: number) => void,
): Promise<string> {
  const { uploadURL, objectPath } = await requestUploadUrl({
    name: file.name,
    size: file.size,
    contentType: file.type,
    purpose: "conversation_attachment",
    conversationId,
  });
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadURL);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Photo upload failed. Check your connection and try again."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Photo upload failed (HTTP ${request.status}).`));
    };
    request.send(file);
  });
  return objectPath;
}

function conversationPhotoUrl(objectPath: string) {
  return `${BASE_URL}/api/storage${objectPath}`;
}

function roleIcon(role: string) {
  if (role === "admin") return <Shield className="w-3.5 h-3.5 text-violet-500" />;
  if (role === "supervisor") return <Users className="w-3.5 h-3.5 text-emerald-500" />;
  if (role === "inspector") return <ClipboardList className="w-3.5 h-3.5 text-amber-500" />;
  if (role === "group") return <Users2 className="w-3.5 h-3.5 text-blue-500" />;
  return <User className="w-3.5 h-3.5 text-slate-500" />;
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function GroupAvatar({ count }: { count: number }) {
  return (
    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
      <Users2 className="w-5 h-5" />
    </div>
  );
}

function emailDeliveryText(status: string) {
  return {
    pending: "Email pending",
    sending: "Email sending",
    retrying: "Email retrying",
    accepted: "Email accepted by provider",
    disabled: "Email delivery disabled",
    not_configured: "Email not configured",
    failed: "Email failed",
  }[status] ?? null;
}

// ── New conversation dialog ────────────────────────────────────────────────────

type DialogMode = "individual" | "group";

interface NewConvoDialogProps {
  senderRole: string;
  staffId: number;
  inspectorId?: number;
  onClose: () => void;
  onStarted: (convo: ConversationSummary) => void;
}

function NewConvoDialog({ senderRole, staffId, inspectorId, onClose, onStarted }: NewConvoDialogProps) {
  const { t } = useTranslation();
  const canGroup = senderRole === "admin" || senderRole === "supervisor";
  // Admins/supervisors land straight on the group/checkbox view
  const [mode, setMode] = useState<DialogMode>(canGroup ? "group" : "individual");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);

  const { data: staffList = [], isLoading } = useQuery({
    queryKey: ["/api/staff"],
    queryFn: () => listStaff(),
  });

  const allowedRecipients = staffList.filter((s) => {
    if (s.id === staffId) return false;
    if (senderRole === "admin") return s.role === "staff" || s.role === "supervisor" || s.role === "inspector";
    if (senderRole === "supervisor") return s.role === "staff" || s.role === "admin" || s.role === "inspector";
    if (senderRole === "inspector") return s.role === "supervisor" || s.role === "admin";
    if (senderRole === "staff") return s.role === "supervisor";
    return false;
  });
  // Group conversations may include every active staff member, while
  // one-to-one conversations keep the existing role-based permissions.
  const groupRecipients =
    canGroup ? staffList.filter((s) => s.id !== staffId) : allowedRecipients;

  const staffGroup = groupRecipients.filter((s) => s.role === "staff");
  const individualStaffRecipients = allowedRecipients
    .filter((s) => s.role === "staff")
    .sort((a, b) => a.name.localeCompare(b.name));
  const supervisorGroup = groupRecipients.filter((s) => s.role === "supervisor");
  const inspectorGroup = groupRecipients.filter((s) => s.role === "inspector");
  const adminGroup = groupRecipients.filter((s) => s.role === "admin");
  // The server restricts this role pairing and validates the inspector's
  // configured address before it queues external delivery.
  const dedicatedInspector =
    (senderRole === "supervisor" || senderRole === "admin")
      ? allowedRecipients.find((s) => s.id === inspectorId && s.role === "inspector" && s.hasEmail)
      : undefined;

  const individualMutation = useMutation({
    mutationFn: (recipientId: number) => startConversation({ staffId, recipientId }),
    onSuccess: onStarted,
  });

  const groupMutation = useMutation({
    mutationFn: () =>
      startGroupConversation({
        staffId,
        recipientIds: [...selected],
        groupName: groupName.trim() || undefined,
      }),
    onSuccess: onStarted,
  });

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const quickSelect = (ids: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => prev.has(id));
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <p className="font-semibold text-slate-800">
            {mode === "group" ? t("messages.newGroup") : t("messages.newConversation")}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode toggle (only admins/supervisors) */}
        {canGroup && (
          <div className="flex gap-1 p-3 bg-slate-50 border-b border-slate-100 shrink-0">
            <button
              onClick={() => setMode("individual")}
              className={`flex-1 text-sm py-1.5 rounded-lg font-medium transition-colors ${
                mode === "individual"
                  ? "bg-white shadow-sm text-slate-800"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t("messages.modeIndividual")}
            </button>
            <button
              onClick={() => setMode("group")}
              className={`flex-1 text-sm py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
                mode === "group"
                  ? "bg-white shadow-sm text-slate-800"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Users2 className="w-3.5 h-3.5" />
              {t("messages.modeGroup")}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <div className="p-6 text-center text-slate-400 text-sm">Loading…</div>
          )}

          {!isLoading && mode === "individual" && (
            <>
              {allowedRecipients.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-sm">{t("messages.noRecipients")}</div>
              )}
              {dedicatedInspector && (
                <button
                  type="button"
                  disabled={individualMutation.isPending}
                  onClick={() => individualMutation.mutate(dedicatedInspector.id)}
                  className="m-3 w-[calc(100%-1.5rem)] rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-left hover:bg-amber-100 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <Mail className="w-4 h-4" />
                    Message inspector@marvolenterprises.com
                    <ChevronRight className="ml-auto w-4 h-4" />
                  </span>
                  <span className="mt-1 block text-xs text-amber-800">
                    Dedicated inspector communication identity
                  </span>
                </button>
              )}
              {individualStaffRecipients.length > 0 && (
                <div className="p-4 border-b border-slate-100">
                  <label htmlFor="new-conversation-staff" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t("messages.chooseStaff")}
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      id="new-conversation-staff"
                      data-testid="new-conversation-staff"
                      value={individualStaffRecipients.some((s) => s.id === selectedStaffId) ? selectedStaffId! : ""}
                      onChange={(e) => setSelectedStaffId(e.target.value ? Number(e.target.value) : null)}
                      disabled={individualMutation.isPending}
                      className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">{t("messages.selectStaffName")}</option>
                      {individualStaffRecipients.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-testid="start-staff-conversation"
                      disabled={individualMutation.isPending || !individualStaffRecipients.some((s) => s.id === selectedStaffId)}
                      onClick={() => {
                        if (selectedStaffId !== null && individualStaffRecipients.some((s) => s.id === selectedStaffId)) {
                          individualMutation.mutate(selectedStaffId);
                        }
                      }}
                      className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      {t("messages.startConversation")}
                    </button>
                  </div>
                </div>
              )}
              {allowedRecipients
                .filter((s) => s.role !== "staff" && s.id !== dedicatedInspector?.id)
                .map((s) => (
                <button
                  key={s.id}
                  disabled={individualMutation.isPending}
                  onClick={() => individualMutation.mutate(s.id)}
                  className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors disabled:opacity-50 border-b border-slate-50 last:border-0"
                >
                  <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                    {initialsOf(s.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{s.name}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      {roleIcon(s.role)}
                      {t(`roles.${s.role}`)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              ))}
              {individualMutation.isError && (
                <p role="alert" className="p-4 text-sm text-rose-700">{t("messages.conversationOpenFailed")}</p>
              )}
            </>
          )}

          {!isLoading && mode === "group" && (
            <div className="p-4 space-y-4">
              {/* Group name */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
                  {t("messages.groupName")}
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder={t("messages.groupNamePlaceholder")}
                  maxLength={100}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Quick select */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {t("messages.quickSelect")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {groupRecipients.length > 0 && (
                    <button
                      type="button"
                      data-testid="button-select-everyone"
                      onClick={() => {
                        const ids = groupRecipients.map((s) => s.id);
                        const allOn = ids.every((id) => selected.has(id));
                        quickSelect(ids);
                        if (!allOn && !groupName.trim()) setGroupName(t("messages.everyone"));
                      }}
                      className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${
                        groupRecipients.every((s) => selected.has(s.id))
                          ? "bg-blue-600 text-white border-blue-600"
                          : "border-blue-300 text-blue-700 hover:border-blue-500 hover:bg-blue-50"
                      }`}
                    >
                      {t("messages.everyone")} ({groupRecipients.length})
                    </button>
                  )}
                  {staffGroup.length > 0 && (
                    <button
                      type="button"
                      onClick={() => quickSelect(staffGroup.map((s) => s.id))}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                        staffGroup.every((s) => selected.has(s.id))
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-slate-300 text-slate-600 hover:border-emerald-500"
                      }`}
                    >
                      {t("messages.allStaff")} ({staffGroup.length})
                    </button>
                  )}
                  {supervisorGroup.length > 0 && (
                    <button
                      type="button"
                      onClick={() => quickSelect(supervisorGroup.map((s) => s.id))}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                        supervisorGroup.every((s) => selected.has(s.id))
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-slate-300 text-slate-600 hover:border-emerald-500"
                      }`}
                    >
                      {t("messages.allSupervisors")} ({supervisorGroup.length})
                    </button>
                  )}
                  {inspectorGroup.length > 0 && (
                    <button
                      type="button"
                      onClick={() => quickSelect(inspectorGroup.map((s) => s.id))}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                        inspectorGroup.every((s) => selected.has(s.id))
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-slate-300 text-slate-600 hover:border-emerald-500"
                      }`}
                    >
                      {t("messages.allInspectors")} ({inspectorGroup.length})
                    </button>
                  )}
                  {adminGroup.length > 0 && (
                    <button
                      type="button"
                      onClick={() => quickSelect(adminGroup.map((s) => s.id))}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                        adminGroup.every((s) => selected.has(s.id))
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-slate-300 text-slate-600 hover:border-emerald-500"
                      }`}
                    >
                      {t("messages.allAdmins")} ({adminGroup.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Individual checkboxes */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {t("messages.orSelectPeople")}
                </p>
                <div className="space-y-1">
                  {groupRecipients.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="w-4 h-4 rounded accent-emerald-600"
                      />
                      <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                        {initialsOf(s.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          {roleIcon(s.role)}
                          {t(`roles.${s.role}`)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Group create button */}
        {mode === "group" && (
          <div className="p-4 border-t border-slate-100 shrink-0">
            <button
              disabled={selected.size === 0 || groupMutation.isPending}
              onClick={() => groupMutation.mutate()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Users2 className="w-4 h-4" />
              {t("messages.createGroup")}
              {selected.size > 0 && (
                <span className="ml-1 bg-blue-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {selected.size + 1}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Messages page ─────────────────────────────────────────────────────────

export default function Messages() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const staffId = currentUser?.id ?? 0;
  const senderRole = currentUser?.role ?? "staff";
  const canEmailInspector = senderRole === "admin" || senderRole === "supervisor";
  const { data: inspectorContacts, isLoading: contactsLoading, isError: contactsError } = useQuery({
    queryKey: ["/api/inspector-email/recipients", staffId],
    queryFn: () => listInspectorEmailRecipients(),
    enabled: canEmailInspector && staffId > 0,
    staleTime: 60_000,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [showFlyer, setShowFlyer] = useState(false);
  const [draft, setDraft] = useState("");
  const [beforePhoto, setBeforePhoto] = useState<File | null>(null);
  const [afterPhoto, setAfterPhoto] = useState<File | null>(null);
  const [beforeImagePath, setBeforeImagePath] = useState<string | null>(null);
  const [afterImagePath, setAfterImagePath] = useState<string | null>(null);
  const [photoProgress, setPhotoProgress] = useState<{ before: number | null; after: number | null }>({ before: null, after: null });
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoDraftConversationId, setPhotoDraftConversationId] = useState<number | null>(null);
  const [inspectorRecipient, setInspectorRecipient] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [cleanupConversationId, setCleanupConversationId] = useState<number | null>(null);
  const [cleanupDate, setCleanupDate] = useState("");
  const [cleanupResult, setCleanupResult] = useState<{ id: number; deleted: number; retained: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedConversationIdRef = useRef<number | null>(selectedId);
  selectedConversationIdRef.current = selectedId;
  const photoUploadIdRef = useRef(0);
  const photoUploadActiveRef = useRef(false);
  const beforePhotoInputRef = useRef<HTMLInputElement>(null);
  const afterPhotoInputRef = useRef<HTMLInputElement>(null);
  const composeRequestRef = useRef<{
    conversationId: number;
    body: string;
    clientRequestId: string;
    beforeImagePath?: string;
    afterImagePath?: string;
    inspectorRecipients?: string[];
  } | null>(null);

  const { data: conversations = [], isLoading: convosLoading, error: convosError } = useQuery({
    queryKey: [CONVERSATIONS_KEY, staffId],
    queryFn: () => listConversations({ staffId }),
    enabled: staffId > 0,
    refetchInterval: 15000,
    retry: (failureCount, error: any) => (error?.status === 401 ? false : failureCount < 2),
  });
  const { data: archivedConversations = [], isLoading: archivedLoading, error: archivedError } = useQuery({
    queryKey: [CONVERSATIONS_KEY, staffId, "archived"],
    queryFn: () => listArchivedConversations({ staffId }),
    enabled: staffId > 0 && showArchived,
    refetchInterval: 15000,
    retry: (failureCount, error: any) => (error?.status === 401 ? false : failureCount < 2),
  });
  const sessionExpired = (convosError as any)?.status === 401;
  const visibleConversations = showArchived ? archivedConversations : conversations;

  const {
    data: messages = [],
    isLoading: messagesLoading,
    error: messagesError,
  } = useQuery({
    queryKey: [CONVERSATIONS_KEY, selectedId, "messages", staffId],
    queryFn: () => listConversationMessages(selectedId!, { staffId }),
    enabled: staffId > 0 && selectedId !== null,
    refetchInterval: 5000,
  });

  const selectedConvo = visibleConversations.find((c) => c.id === selectedId) ?? null;
  const photoDraftMatchesConversation = photoDraftConversationId === selectedId;
  const activeBeforePhoto = photoDraftMatchesConversation ? beforePhoto : null;
  const activeAfterPhoto = photoDraftMatchesConversation ? afterPhoto : null;
  const activeBeforeImagePath = photoDraftMatchesConversation ? beforeImagePath : null;
  const activeAfterImagePath = photoDraftMatchesConversation ? afterImagePath : null;
  const isSharedInspectorThread = canEmailInspector && !selectedConvo?.isGroup &&
    selectedConvo?.otherStaffId === inspectorContacts?.inspectorId;

  const unreadInSelected = useMemo(
    () => messages.some((m) => m.senderId !== staffId && !m.isRead),
    [messages, staffId]
  );
  // For group convos, also mark read when messages arrive (isRead is always
  // false for group messages — we use lastReadAt instead).
  const hasNewGroupMessages = useMemo(
    () =>
      selectedConvo?.isGroup === true &&
      messages.length > 0 &&
      messages[messages.length - 1]?.senderId !== staffId,
    [selectedConvo, messages, staffId]
  );

  useEffect(() => {
    if (selectedId === null) return;
    if (!unreadInSelected && !hasNewGroupMessages) return;
    markConversationRead(selectedId, { staffId }).then(() => {
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    });
  }, [selectedId, unreadInSelected, hasNewGroupMessages, staffId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedId]);

  useLayoutEffect(() => {
    photoUploadIdRef.current += 1;
    photoUploadActiveRef.current = false;
    setEditingMessageId(null);
    setEditDraft("");
    setEditError(null);
    setInspectorRecipient("");
    setPhotoDraftConversationId(null);
    setBeforePhoto(null);
    setAfterPhoto(null);
    setBeforeImagePath(null);
    setAfterImagePath(null);
    setPhotoProgress({ before: null, after: null });
    setPhotoError(null);
    setUploadingPhotos(false);
    if (beforePhotoInputRef.current) beforePhotoInputRef.current.value = "";
    if (afterPhotoInputRef.current) afterPhotoInputRef.current.value = "";
  }, [selectedId]);

  const sendMutation = useMutation({
    mutationFn: (submission: { conversationId: number; body: string; clientRequestId: string; beforeImagePath?: string; afterImagePath?: string; inspectorRecipients?: string[] }) =>
      sendConversationMessage(submission.conversationId, {
        senderId: staffId,
        body: submission.body,
        clientRequestId: submission.clientRequestId,
        ...(submission.beforeImagePath ? { beforeImagePath: submission.beforeImagePath } : {}),
        ...(submission.afterImagePath ? { afterImagePath: submission.afterImagePath } : {}),
        ...(submission.inspectorRecipients ? { inspectorRecipients: submission.inspectorRecipients } : {}),
      }),
    onSuccess: (_message, submission) => {
      if (composeRequestRef.current?.clientRequestId === submission.clientRequestId) {
        composeRequestRef.current = null;
      }
      if (selectedId === submission.conversationId) {
        setDraft("");
        setBeforePhoto(null);
        setAfterPhoto(null);
        setBeforeImagePath(null);
        setAfterImagePath(null);
        setPhotoDraftConversationId(null);
        setPhotoProgress({ before: null, after: null });
        setPhotoError(null);
      }
      if (submission.inspectorRecipients && selectedId === submission.conversationId) setInspectorRecipient("");
      trackEvent("message_sent", {
        conversation_type: selectedConvo?.otherStaffRole === "inspector" ? "inspector" : "standard",
        sender_role: senderRole,
      });
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY, submission.conversationId, "messages"] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      setConversationArchive(id, { staffId, archived }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
      setSelectedId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ convoId, msgId }: { convoId: number; msgId: number }) =>
      deleteConversationMessage(convoId, msgId, { staffId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY, selectedId, "messages"] });
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: ({ id, before }: { id: number; before: string }) =>
      deleteOldConversationMessages(id, { before }),
    onSuccess: (result, { id }) => {
      setCleanupConversationId(null);
      setCleanupDate("");
      setCleanupResult({ id, ...result });
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY, id, "messages"] });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ convoId, msgId, body }: { convoId: number; msgId: number; body: string }) =>
      updateConversationMessage(convoId, msgId, { senderId: staffId, body }),
    onSuccess: () => {
      setEditingMessageId(null);
      setEditDraft("");
      setEditError(null);
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY, selectedId, "messages"] });
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    },
    onError: () => {
      setEditError(t("messages.editFailed"));
    },
  });

  const receiptMutation = useMutation({
    mutationFn: ({ conversationId, messageId }: { conversationId: number; messageId: number; viewerId: number }) =>
      confirmConversationMessageReceipt(conversationId, messageId),
    onSuccess: (confirmation, variables) => {
      const queryKey = [CONVERSATIONS_KEY, variables.conversationId, "messages", variables.viewerId] as const;
      qc.setQueryData<typeof messages>(queryKey, (previous) =>
        previous?.map((message) => message.id === variables.messageId
          ? { ...message, receipt: confirmation.receipt, receiptVersion: confirmation.receipt.version }
          : message),
      );
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY, variables.conversationId, "messages"] });
    },
  });

  const handleDelete = (convoId: number, msgId: number) => {
    if (!window.confirm(t("messages.confirmDelete"))) return;
    deleteMutation.mutate({ convoId, msgId });
  };

  const handleDeleteOld = () => {
    if (selectedId === null || cleanupConversationId !== selectedId || !cleanupDate || cleanupMutation.isPending) return;
    const before = new Date(`${cleanupDate}T00:00:00`);
    if (Number.isNaN(before.getTime()) || before.getTime() > Date.now()) return;
    if (!window.confirm(t("messages.confirmDeleteOld", { date: cleanupDate }))) return;
    cleanupMutation.mutate({ id: selectedId, before: before.toISOString() });
  };

  const handleSend = async () => {
    const body = draft.trim();
    const conversationId = selectedId;
    if (!body || conversationId === null || selectedConversationIdRef.current !== conversationId ||
        sendMutation.isPending || uploadingPhotos || photoUploadActiveRef.current) return;
    if (selectedConvo?.otherStaffRole === "inspector" && canEmailInspector &&
        (!inspectorContacts || contactsError || !isSharedInspectorThread)) return;
    if (isSharedInspectorThread && !inspectorRecipient) return;
    const inspectorRecipients = isSharedInspectorThread
      ? inspectorRecipient === "all"
        ? inspectorContacts!.emails
        : [inspectorRecipient]
      : undefined;
    const attachmentContextMatches = photoDraftConversationId === conversationId;
    const selectedBeforePhoto = attachmentContextMatches ? beforePhoto : null;
    const selectedAfterPhoto = attachmentContextMatches ? afterPhoto : null;
    let uploadedBeforePath = (attachmentContextMatches ? beforeImagePath : null) ?? undefined;
    let uploadedAfterPath = (attachmentContextMatches ? afterImagePath : null) ?? undefined;
    const uploadId = ++photoUploadIdRef.current;
    const isCurrentUpload = () =>
      photoUploadIdRef.current === uploadId && selectedConversationIdRef.current === conversationId;
    photoUploadActiveRef.current = true;
    setPhotoError(null);
    setUploadingPhotos(true);
    try {
      if (selectedBeforePhoto && !uploadedBeforePath) {
        if (selectedBeforePhoto.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(selectedBeforePhoto.type)) {
          throw new Error("Before photo must be a JPEG, PNG, or WebP image no larger than 10 MB.");
        }
        setPhotoProgress((progress) => ({ ...progress, before: 0 }));
        const path = await uploadConversationPhoto(selectedBeforePhoto, conversationId, (progress) => {
          if (isCurrentUpload()) setPhotoProgress((current) => ({ ...current, before: progress }));
        });
        if (!isCurrentUpload()) return;
        uploadedBeforePath = path;
        setBeforeImagePath(uploadedBeforePath);
      }
      if (selectedAfterPhoto && !uploadedAfterPath) {
        if (selectedAfterPhoto.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(selectedAfterPhoto.type)) {
          throw new Error("After photo must be a JPEG, PNG, or WebP image no larger than 10 MB.");
        }
        setPhotoProgress((progress) => ({ ...progress, after: 0 }));
        const path = await uploadConversationPhoto(selectedAfterPhoto, conversationId, (progress) => {
          if (isCurrentUpload()) setPhotoProgress((current) => ({ ...current, after: progress }));
        });
        if (!isCurrentUpload()) return;
        uploadedAfterPath = path;
        setAfterImagePath(uploadedAfterPath);
      }
    } catch (error) {
      if (isCurrentUpload()) setPhotoError(error instanceof Error ? error.message : "Photo upload failed. Please try again.");
      return;
    } finally {
      if (photoUploadIdRef.current === uploadId) {
        photoUploadActiveRef.current = false;
        if (selectedConversationIdRef.current === conversationId) setUploadingPhotos(false);
      }
    }
    if (!isCurrentUpload()) return;
    setPhotoProgress({ before: null, after: null });
    const prior = composeRequestRef.current;
    const submission =
      prior?.conversationId === conversationId && prior.body === body &&
      prior.beforeImagePath === uploadedBeforePath &&
      prior.afterImagePath === uploadedAfterPath &&
      JSON.stringify(prior.inspectorRecipients) === JSON.stringify(inspectorRecipients)
        ? prior
        : {
            conversationId,
            body,
            clientRequestId: crypto.randomUUID(),
            beforeImagePath: uploadedBeforePath,
            afterImagePath: uploadedAfterPath,
            inspectorRecipients,
          };
    composeRequestRef.current = submission;
    sendMutation.mutate({
      conversationId: submission.conversationId,
      body: submission.body,
      clientRequestId: submission.clientRequestId,
      beforeImagePath: submission.beforeImagePath,
      afterImagePath: submission.afterImagePath,
      inspectorRecipients: submission.inspectorRecipients,
    });
  };

  const handleStartEdit = (msgId: number, body: string) => {
    setEditingMessageId(msgId);
    setEditDraft(body);
    setEditError(null);
  };

  const handleCancelEdit = () => {
    if (editMutation.isPending) return;
    setEditingMessageId(null);
    setEditDraft("");
    setEditError(null);
  };

  const handleSaveEdit = () => {
    const body = editDraft.trim();
    if (!body) {
      setEditError(t("messages.editRequired"));
      return;
    }
    const messageId = editingMessageId;
    if (messageId === null || editMutation.isPending) return;
    const editingMessage = messages.find((message) => message.id === messageId);
    if (!editingMessage) return;
    setEditError(null);
    editMutation.mutate({ convoId: editingMessage.conversationId, msgId: messageId, body });
  };

  const handleStarted = (convo: ConversationSummary) => {
    setShowNewConvo(false);
    setSelectedId(convo.id);
    qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
  };

  const toggleArchiveView = () => {
    setSelectedId(null);
    setShowArchived((current) => !current);
  };

  const today = new Date();
  const latestCleanupDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const inspectorMutation = useMutation({
    mutationFn: async () => {
      const [staff, contacts] = await Promise.all([listStaff(), listInspectorEmailRecipients()]);
      const inspector = staff.find((s) => s.id === contacts.inspectorId && s.active && s.role === "inspector" && s.hasEmail);
      if (!inspector) throw new Error(t("messages.inspectorUnavailable"));
      const convo = await startConversation({ staffId, recipientId: inspector.id });
      await setConversationArchive(convo.id, { staffId, archived: false });
      return convo;
    },
    onSuccess: (convo) => {
      trackEvent("inspector_conversation_opened", { sender_role: senderRole });
      setShowArchived(false);
      handleStarted(convo);
    },
  });

  const canStartConversation =
    senderRole === "admin" || senderRole === "supervisor" || senderRole === "staff";

  return (
    <div className="p-4 md:p-6 h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-emerald-600" />
            {t("messages.title")}
          </h1>
          <p className="text-sm text-slate-500">{t("messages.subtitle")}</p>
        </div>
        {canStartConversation && (
          <button
            onClick={() => setShowNewConvo(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t("messages.newConversation")}</span>
          </button>
        )}
      </div>

      {canEmailInspector && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 shrink-0">
          <button type="button" data-testid="inspector-messages"
            disabled={inspectorMutation.isPending}
            onClick={() => inspectorMutation.mutate()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50">
            <Mail className="h-5 w-5" /> {t("messages.inspectorMessages")}
            <ChevronRight className="ml-auto h-5 w-5" />
          </button>
          <p className="px-3 text-sm text-amber-900">{t("messages.inspectorEmailHelp")}</p>
          {inspectorMutation.isError && <p role="alert" className="mt-2 px-3 text-sm text-red-700">{inspectorMutation.error.message || t("messages.inspectorOpenFailed")}</p>}
        </div>
      )}

      <section
        data-testid="card-human-trafficking-announcement"
        className="mb-4 rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-amber-50 overflow-hidden shrink-0"
        aria-labelledby="human-trafficking-announcement-title"
      >
        <div className="flex items-center gap-4 p-3 sm:p-4">
          <button
            type="button"
            data-testid="button-view-human-trafficking-flyer"
            onClick={() => setShowFlyer(true)}
            className="relative w-20 sm:w-24 md:w-28 shrink-0 rounded-xl overflow-hidden shadow-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="View the MCO Cares Human Trafficking Awareness flyer"
          >
            <img
              data-testid="img-human-trafficking-flyer"
              src={humanTraffickingFlyer}
              alt="MCO Cares Human Trafficking Awareness event flyer"
              className="block aspect-[3/4] w-full object-cover object-top"
            />
            <span className="absolute inset-x-1 bottom-1 rounded-md bg-slate-900/75 px-1 py-1 text-center text-[10px] font-semibold text-white">
              View flyer
            </span>
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-700">MCO Cares</p>
            <h2 id="human-trafficking-announcement-title" className="mt-0.5 text-sm sm:text-base font-bold text-slate-800">
              Human Trafficking Awareness
            </h2>
            <p className="mt-1 text-xs sm:text-sm font-semibold text-slate-700">
              Thursday, August 20, 2026 · 2:00–3:00 PM · Virtual
            </p>
            <p className="mt-1 hidden text-xs text-slate-500 sm:block">
              Join MCO Cares to learn how to recognize the signs and respond safely.
            </p>
          </div>
        </div>
      </section>

      <div className="flex-1 min-h-0 flex gap-4">
        {/* Conversation list */}
        <div
          className={`${selectedId !== null ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 overflow-hidden`}
        >
          <div className="border-b border-slate-100 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-500">
              {showArchived ? "Archived conversations" : "Active conversations"}
            </span>
            <button
              type="button"
              onClick={toggleArchiveView}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {showArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              {showArchived ? "Inbox" : "Archive"}
            </button>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
            {sessionExpired && (
              <div className="p-6 text-center text-amber-600 text-sm">{t("messages.sessionExpired")}</div>
            )}
            {(convosLoading || (showArchived && archivedLoading)) && (
              <div className="p-6 text-center text-slate-400 text-sm">{t("common.loading")}</div>
            )}
            {!convosLoading && !archivedLoading && (showArchived ? archivedError : convosError) && !sessionExpired && (
              <div className="p-6 text-center text-rose-600 text-sm">
                Conversations could not be refreshed. Please try again.
              </div>
            )}
            {!convosLoading && !archivedLoading && visibleConversations.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                {showArchived ? "No archived conversations." : t("messages.noConversations")}
              </div>
            )}
            {[...visibleConversations]
              .sort((a, b) => Number(b.otherStaffRole === "inspector") - Number(a.otherStaffRole === "inspector"))
              .map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-slate-50 ${selectedId === c.id ? "bg-emerald-50" : ""}`}
              >
                {c.isGroup ? (
                  <GroupAvatar count={c.participantCount} />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-sm font-bold shrink-0">
                    {initialsOf(c.otherStaffName)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-800 text-sm truncate">{c.otherStaffName}</span>
                    {roleIcon(c.otherStaffRole)}
                    {c.otherStaffRole === "inspector" && (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500" aria-label="Inspector messages are urgent" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {c.isGroup
                      ? c.lastMessage
                        ? c.lastMessage
                        : t("messages.groupMembersCount", { count: c.participantCount })
                      : (c.lastMessage ?? t("messages.noMessagesYet"))}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {c.lastMessageAt && (
                    <span className="text-[10px] text-slate-400">
                      {format(new Date(c.lastMessageAt), "MMM d")}
                    </span>
                  )}
                  {c.unreadCount > 0 && (
                    <span className="min-w-[18px] h-[18px] rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center px-1">
                      {c.unreadCount > 9 ? "9+" : c.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div
          className={`${selectedId === null ? "hidden md:flex" : "flex"} flex-col flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 overflow-hidden`}
        >
          {selectedConvo === null ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-sm p-8">
              <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
              {t("messages.selectConversation")}
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                {selectedConvo.isGroup ? (
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Users2 className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                    {initialsOf(selectedConvo.otherStaffName)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">
                    {selectedConvo.otherStaffName}
                  </p>
                  {selectedConvo.isGroup ? (
                    <p className="text-xs text-slate-500 truncate">
                      {t("messages.groupMembersCount", { count: selectedConvo.participantCount })}
                      {selectedConvo.participantNames.length > 0 && (
                        <> · {selectedConvo.participantNames.slice(0, 3).join(", ")}{selectedConvo.participantNames.length > 3 ? ` +${selectedConvo.participantNames.length - 3}` : ""}</>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      {roleIcon(selectedConvo.otherStaffRole)}
                      {t(`roles.${selectedConvo.otherStaffRole}`)}
                    </p>
                  )}
                </div>
                  <button
                    type="button"
                    onClick={() => archiveMutation.mutate({ id: selectedConvo.id, archived: !showArchived })}
                    disabled={archiveMutation.isPending}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    aria-label={showArchived ? "Restore conversation to inbox" : "Archive conversation"}
                    title={showArchived ? "Restore to inbox" : "Archive conversation"}
                  >
                    {showArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                  </button>
                  {senderRole === "admin" && !isSharedInspectorThread && (
                    <button
                      type="button"
                      data-testid="toggle-delete-old-messages"
                      onClick={() => {
                        if (cleanupConversationId === selectedConvo.id) {
                          setCleanupConversationId(null);
                        } else {
                          setCleanupConversationId(selectedConvo.id);
                          setCleanupDate("");
                          setCleanupResult(null);
                          cleanupMutation.reset();
                        }
                      }}
                      disabled={cleanupMutation.isPending}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                      aria-label={t("messages.deleteOldMessages")}
                      title={t("messages.deleteOldMessages")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
              </div>
                {senderRole === "admin" && !isSharedInspectorThread && cleanupConversationId === selectedConvo.id && (
                  <div className="mx-4 mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                    <label htmlFor="old-message-cutoff" className="block font-semibold mb-2">
                      {t("messages.deleteBeforeDate")}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id="old-message-cutoff"
                        data-testid="old-message-cutoff"
                        type="date"
                        max={latestCleanupDate}
                        value={cleanupDate}
                        onChange={(event) => setCleanupDate(event.target.value)}
                        disabled={cleanupMutation.isPending}
                        className="min-w-0 rounded-lg border border-rose-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400"
                      />
                      <button
                        type="button"
                        data-testid="confirm-delete-old-messages"
                        disabled={!cleanupDate || cleanupDate > latestCleanupDate || cleanupMutation.isPending}
                        onClick={handleDeleteOld}
                        className="rounded-lg bg-rose-700 px-3 py-2 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
                      >
                        {t("messages.deleteOldMessages")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCleanupConversationId(null)}
                        disabled={cleanupMutation.isPending}
                        className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-rose-100 disabled:opacity-40"
                      >
                        {t("messages.cancel")}
                      </button>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed">{t("messages.oldMessageCleanupHelp")}</p>
                    {cleanupMutation.isError && (
                      <p role="alert" className="mt-2 font-medium">{t("messages.oldMessageCleanupFailed")}</p>
                    )}
                  </div>
                )}
                {cleanupResult?.id === selectedConvo.id && (
                  <p role="status" className="mx-4 mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {t("messages.oldMessageCleanupDone", cleanupResult)}
                  </p>
                )}
                {isSharedInspectorThread && (
                  <div className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="flex items-center gap-1 font-semibold">
                      <Mail className="w-3.5 h-3.5" />
                      {t("messages.inspectorEmailIdentity")}
                    </div>
                    <p className="mt-0.5">
                      {t("messages.inspectorDeliveryNote")}
                    </p>
                  </div>
                )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
                {messagesLoading && (
                  <div className="text-center text-slate-400 text-sm py-8">{t("common.loading")}</div>
                )}
                {messagesError && !messagesLoading && (
                  <div className="text-center text-rose-600 text-sm py-8">
                    Messages could not be refreshed. Please try again.
                  </div>
                )}
                {!messagesLoading && !messagesError && messages.length === 0 && (
                  <div className="text-center text-slate-400 text-sm py-8">
                    {t("messages.startOfConversation")}
                  </div>
                )}
                {!messagesError && messages.map((m) => {
                  const mine = m.senderId === staffId;
                  const urgentInspectorReply = m.senderId === selectedConvo.otherStaffId && selectedConvo.otherStaffRole === "inspector";
                  const isEditing = editingMessageId === m.id;
                  const canDelete = senderRole === "admin";
                  const messageActions = !isEditing && (mine || canDelete) && (
                    <div className="flex items-center gap-0.5 shrink-0 mb-1">
                      {mine && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(m.id, m.body)}
                          disabled={editMutation.isPending || deleteMutation.isPending}
                          className="p-1 text-slate-400 hover:text-emerald-600 disabled:opacity-50"
                          aria-label={t("messages.editMessage")}
                          title={t("messages.editMessage")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(m.conversationId, m.id)}
                          disabled={deleteMutation.isPending || editMutation.isPending}
                          className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-50"
                          aria-label={t("messages.deleteMessage")}
                          title={t("messages.deleteMessage")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                  return (
                    <div key={m.id} className={`flex items-end gap-1.5 group ${mine ? "justify-end" : "justify-start"}`}>
                      {mine && messageActions}
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          mine
                            ? "bg-emerald-600 text-white rounded-br-md"
                            : urgentInspectorReply
                              ? "bg-amber-50 border-2 border-amber-400 text-slate-800 rounded-bl-md"
                              : "bg-white border border-slate-200 text-slate-800 rounded-bl-md"
                        }`}
                      >
                        {!mine && (
                          <p className="text-[11px] font-semibold text-emerald-700 mb-0.5 flex items-center gap-1">
                            {urgentInspectorReply && <AlertTriangle className="w-3 h-3 text-red-500" />}
                            {urgentInspectorReply ? "URGENT inspector reply · " : ""}{m.senderName}
                          </p>
                        )}
                        {isEditing ? (
                          <div className="space-y-2">
                            <textarea
                              autoFocus
                              value={editDraft}
                              onChange={(e) => {
                                setEditDraft(e.target.value);
                                if (editError) setEditError(null);
                              }}
                              onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveEdit();
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  handleCancelEdit();
                                }
                              }}
                              disabled={editMutation.isPending}
                              rows={3}
                              maxLength={2000}
                              aria-label={t("messages.editMessage")}
                              placeholder={t("messages.editMessagePlaceholder")}
                              className="w-full resize-y rounded-lg border border-emerald-200 bg-white px-2.5 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-60"
                            />
                            {editError && (
                              <p role="alert" className="text-xs text-rose-100">
                                {editError}
                              </p>
                            )}
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                disabled={editMutation.isPending}
                                className="rounded-lg bg-emerald-700/80 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {t("messages.cancel")}
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={!editDraft.trim() || editMutation.isPending}
                                className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                {editMutation.isPending ? t("messages.saving") : t("messages.save")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        )}
                        {(m.beforeImagePath || m.afterImagePath) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {([
                              ["Before", m.beforeImagePath],
                              ["After", m.afterImagePath],
                            ] as const).map(([label, path]) => path && (
                              <button key={label} type="button" onClick={() => setLightboxPath(path)}
                                className="group/photo w-24 overflow-hidden rounded-lg border border-white/30 text-left"
                                aria-label={`View ${label.toLowerCase()} photo`}>
                                <span className={`block px-1.5 py-0.5 text-[10px] font-semibold ${mine ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}>{label}</span>
                                <img src={conversationPhotoUrl(path)} alt={`${label} photo`} loading="lazy"
                                  className="h-20 w-full object-cover transition-transform group-hover/photo:scale-105" />
                              </button>
                            ))}
                          </div>
                        )}
                        {(mine || isSharedInspectorThread) && m.inspectorEmailRecipients.length > 0 && (
                          <div className="mt-2 text-[11px] text-emerald-100 break-all">
                            {t("messages.emailRecipient")}: {m.inspectorEmailRecipients.length === 1
                              ? m.inspectorEmailRecipients[0]
                              : t("messages.allInspectorRecipients", { count: m.inspectorEmailRecipients.length })}
                            {m.inspectorEmailRecipients.length > 1 && (
                              <details className="mt-0.5">
                                <summary className="cursor-pointer underline">{t("messages.viewEmailRecipients")}</summary>
                                <ul className="mt-1 space-y-0.5">
                                  {m.inspectorEmailRecipients.map((email) => <li key={email}>{email}</li>)}
                                </ul>
                              </details>
                            )}
                          </div>
                        )}
                        <p className={`text-[10px] mt-1 ${mine ? "text-emerald-100" : "text-slate-400"}`}>
                          {format(new Date(m.createdAt), "MMM d, h:mm a")}
                        </p>
                        {emailDeliveryText(m.inspectorEmailDeliveryStatus) && (
                          <p data-testid={`status-email-delivery-${m.id}`} className={`text-[10px] mt-1 font-semibold ${mine ? "text-emerald-100" : "text-slate-500"}`}>
                            {emailDeliveryText(m.inspectorEmailDeliveryStatus)}
                            {m.inspectorEmailDeliveryStatus === "accepted" && m.inspectorEmailAcceptedAt
                              ? ` · ${format(new Date(m.inspectorEmailAcceptedAt), "MMM d, h:mm a")}`
                              : ""}
                          </p>
                        )}
                        {m.inboundEmailReceivedAt && (
                          <p data-testid={`status-email-received-${m.id}`} className={`text-[10px] mt-1 ${mine ? "text-emerald-100" : "text-slate-500"}`}>
                            Inbound email received · {format(new Date(m.inboundEmailReceivedAt), "MMM d, h:mm a")}
                          </p>
                        )}
                        <MessageReceiptStatus
                          receipt={m.receipt}
                          pending={receiptMutation.isPending && receiptMutation.variables?.messageId === m.id}
                          error={receiptMutation.isError && receiptMutation.variables?.messageId === m.id}
                          onConfirm={() => {
                            if (selectedId !== null) {
                              receiptMutation.mutate({ conversationId: selectedId, messageId: m.id, viewerId: staffId });
                            }
                          }}
                          formatTimestamp={(timestamp) => format(new Date(timestamp), "MMM d, h:mm a")}
                          labels={{
                            unconfirmed: t("messages.receiptUnconfirmed"),
                            confirmed: (name, role, time) => t("messages.receiptConfirmed", { name, role, time }),
                            scopeNote: t("messages.receiptScopeNote"),
                            confirm: t("messages.confirmReceipt"),
                            pending: t("messages.receiptPending"),
                            error: t("messages.receiptError"),
                            historyLabel: t("messages.receiptHistoryLabel"),
                            earlierVersion: (version, name, role, time) =>
                              t("messages.receiptEarlierVersion", { version, name, role, time }),
                          }}
                          tone={mine ? "mine" : "other"}
                        />
                        {deleteMutation.isError && deleteMutation.variables?.msgId === m.id && (
                          <p role="alert" className={`mt-1 text-[11px] font-semibold ${mine ? "text-rose-100" : "text-rose-700"}`}>
                            {(deleteMutation.error as { status?: number } | null)?.status === 409
                              ? t("messages.receiptDeleteRetained")
                              : t("messages.messageDeleteFailed")}
                          </p>
                        )}
                        {m.inspectorWorkflowTaskId && (
                          <InspectorWorkflowCard taskId={m.inspectorWorkflowTaskId} />
                        )}
                      </div>
                      {!mine && messageActions}
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-slate-100 shrink-0">
                {isSharedInspectorThread && (
                  <div className="mb-2">
                    <label htmlFor="inspector-email-recipient" className="block text-xs font-semibold text-slate-700 mb-1">
                      {t("messages.emailRecipient")}
                    </label>
                    <select id="inspector-email-recipient" data-testid="inspector-email-recipient"
                       value={inspectorRecipient} onChange={(e) => setInspectorRecipient(e.target.value)}
                       disabled={uploadingPhotos}
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
                      <option value="">{t("messages.chooseEmailRecipient")}</option>
                      <option value="all">{t("messages.allInspectorRecipients", { count: inspectorContacts?.emails.length ?? 0 })}</option>
                      {inspectorContacts?.emails.map((email) => <option key={email} value={email}>{email}</option>)}
                    </select>
                  </div>
                )}
                {selectedConvo.otherStaffRole === "inspector" && canEmailInspector && (contactsLoading || contactsError) && (
                  <p role={contactsError ? "alert" : "status"} className="mb-2 text-xs text-amber-800">
                    {contactsError ? t("messages.inspectorRecipientsUnavailable") : t("common.loading")}
                  </p>
                )}
                {sendMutation.isError && (
                  <p role="alert" className="mb-2 text-xs text-rose-700">{t("messages.sendFailed")}</p>
                )}
                {photoDraftMatchesConversation && photoError && <p role="alert" className="mb-2 text-xs text-rose-700">{photoError}</p>}
                <div className="mb-2 flex flex-wrap gap-2">
                  {([
                    { label: "Before photo", key: "before" as const, file: activeBeforePhoto, path: activeBeforeImagePath, setFile: setBeforePhoto, setPath: setBeforeImagePath, progress: photoProgress.before },
                    { label: "After photo", key: "after" as const, file: activeAfterPhoto, path: activeAfterImagePath, setFile: setAfterPhoto, setPath: setAfterImagePath, progress: photoProgress.after },
                  ]).map((photo) => (
                    <div key={photo.key} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                      <label className={`flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700 ${uploadingPhotos || sendMutation.isPending ? "pointer-events-none opacity-50" : "hover:text-emerald-700"}`}>
                        <Camera className="h-4 w-4 shrink-0" />
                        <span>{photo.file?.name ?? (photo.path ? `${photo.label} attached` : photo.label)}</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                          ref={photo.key === "before" ? beforePhotoInputRef : afterPhotoInputRef}
                          disabled={uploadingPhotos || sendMutation.isPending}
                          aria-label={photo.label}
                          onChange={(event) => {
                            const selected = event.target.files?.[0] ?? null;
                            event.currentTarget.value = "";
                            const conversationId = selectedConversationIdRef.current;
                            if (conversationId === null) return;
                            if (photoDraftConversationId !== conversationId) {
                              setBeforePhoto(null);
                              setAfterPhoto(null);
                              setBeforeImagePath(null);
                              setAfterImagePath(null);
                            }
                            setPhotoDraftConversationId(conversationId);
                            photo.setFile(selected);
                            photo.setPath(null);
                            setPhotoError(null);
                            setPhotoProgress((progress) => ({ ...progress, [photo.key]: null }));
                          }} />
                      </label>
                      {photoDraftMatchesConversation && photo.progress !== null && (
                        <span role="status" className="text-[10px] text-slate-500">{photo.progress}%</span>
                      )}
                      {(photo.file || photo.path) && !uploadingPhotos && (
                        <button type="button" onClick={() => { photo.setFile(null); photo.setPath(null); setPhotoError(null); }}
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Remove ${photo.label.toLowerCase()}`}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {uploadingPhotos && <p role="status" className="mb-2 flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Uploading photos…</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    disabled={uploadingPhotos}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    rows={selectedConvo.otherStaffRole === "inspector" ? 4 : 1}
                    maxLength={2000}
                    placeholder={t("messages.typeMessage")}
                    className={`flex-1 min-w-0 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 ${
                      selectedConvo.otherStaffRole === "inspector" ? "resize-y min-h-24 max-h-48" : "resize-none max-h-32"
                    }`}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim() || sendMutation.isPending || uploadingPhotos ||
                      (isSharedInspectorThread && !inspectorRecipient) ||
                      (selectedConvo.otherStaffRole === "inspector" && canEmailInspector && !isSharedInspectorThread)}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl p-2.5 transition-colors shrink-0"
                    aria-label={t("messages.send")}
                  >
                    {uploadingPhotos ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showNewConvo && (
        <NewConvoDialog
          senderRole={senderRole}
          staffId={staffId}
          inspectorId={inspectorContacts?.inspectorId}
          onClose={() => setShowNewConvo(false)}
          onStarted={handleStarted}
        />
      )}
      {lightboxPath && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightboxPath(null)}>
          <button type="button" onClick={() => setLightboxPath(null)} aria-label="Close photo"
            className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
            <X className="h-6 w-6" />
          </button>
          <img src={conversationPhotoUrl(lightboxPath)} alt="Conversation attachment" onClick={(event) => event.stopPropagation()}
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain shadow-2xl" />
        </div>
      )}

      {showFlyer && (
        <div
          data-testid="dialog-human-trafficking-flyer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="MCO Cares Human Trafficking Awareness flyer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowFlyer(false);
          }}
        >
          <div className="relative max-h-full max-w-3xl rounded-2xl bg-white p-2 shadow-2xl">
            <button
              type="button"
              data-testid="button-close-human-trafficking-flyer"
              onClick={() => setShowFlyer(false)}
              className="absolute right-3 top-3 z-10 rounded-full bg-slate-900/75 p-2 text-white transition-colors hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              aria-label="Close flyer"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={humanTraffickingFlyer}
              alt="MCO Cares Human Trafficking Awareness event flyer"
              className="max-h-[calc(100vh-2rem)] w-auto max-w-full rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
