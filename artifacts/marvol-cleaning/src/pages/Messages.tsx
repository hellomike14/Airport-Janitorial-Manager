import { useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Archive,
  ArchiveRestore,
  Inbox,
  MapPin,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import humanTraffickingFlyer from "@assets/MCO_Human_Trafficing_1787144155521.jpeg";
import {
  listConversationMessages,
  startConversation,
  startInspectorConversation,
  startGroupConversation,
  sendConversationMessage,
  markConversationRead,
  updateConversationMessage,
  listConversations,
  setConversationArchived,
  listStaff,
  listAreas,
  assignInspectorMessage,
  type ConversationSummary,
} from "@workspace/api-client-react";

const CONVERSATIONS_KEY = "/api/conversations";
type MailboxView = "inbox" | "archived";

function createClientRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
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

// ── New conversation dialog ────────────────────────────────────────────────────

type DialogMode = "individual" | "group";

interface NewConvoDialogProps {
  senderRole: string;
  staffId: number;
  onClose: () => void;
  onStarted: (convo: ConversationSummary) => void;
}

function NewConvoDialog({ senderRole, staffId, onClose, onStarted }: NewConvoDialogProps) {
  const { t } = useTranslation();
  const canGroup = senderRole === "admin" || senderRole === "supervisor";
  // Admins/supervisors land straight on the group/checkbox view
  const [mode, setMode] = useState<DialogMode>(canGroup ? "group" : "individual");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: staffList = [], isLoading } = useQuery({
    queryKey: ["/api/staff"],
    queryFn: () => listStaff(),
  });

  const allowedRecipients = staffList.filter((s) => {
    if (s.id === staffId) return false;
    if (senderRole === "admin") return s.role === "staff" || s.role === "supervisor";
    if (senderRole === "supervisor") return s.role === "staff" || s.role === "admin" || s.role === "inspector";
    if (senderRole === "inspector") return s.role === "supervisor";
    if (senderRole === "staff") return s.role === "supervisor";
    return false;
  });
  // Group conversations may include every active staff member, while
  // one-to-one conversations keep the existing role-based permissions.
  const groupRecipients =
    canGroup ? staffList.filter((s) => s.id !== staffId) : allowedRecipients;

  const staffGroup = groupRecipients.filter((s) => s.role === "staff");
  const supervisorGroup = groupRecipients.filter((s) => s.role === "supervisor");
  const inspectorGroup = groupRecipients.filter((s) => s.role === "inspector");
  const adminGroup = groupRecipients.filter((s) => s.role === "admin");

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
              {allowedRecipients.map((s) => (
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

export function MessagesView({
  inspectorChannel = false,
  embedded = false,
}: {
  inspectorChannel?: boolean;
  embedded?: boolean;
} = {}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const staffId = currentUser?.id ?? 0;
  const senderRole = currentUser?.role ?? "staff";

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mailboxView, setMailboxView] = useState<MailboxView>("inbox");
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [showFlyer, setShowFlyer] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [triageMessageId, setTriageMessageId] = useState<number | null>(null);
  const [triageAreaId, setTriageAreaId] = useState("");
  const [triageDate, setTriageDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageNotice, setTriageNotice] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingSendRef = useRef<{
    conversationId: number;
    body: string;
    clientRequestId: string;
  } | null>(null);

  const { data: conversations = [], isLoading: convosLoading, error: convosError } = useQuery({
    queryKey: [CONVERSATIONS_KEY, staffId, mailboxView],
    queryFn: () =>
      listConversations({ staffId, archived: mailboxView === "archived" }),
    enabled: staffId > 0,
    refetchInterval: 15000,
    retry: (failureCount, error: any) => (error?.status === 401 ? false : failureCount < 2),
  });
  const inspectorChannelQuery = useQuery({
    queryKey: [CONVERSATIONS_KEY, "inspector-channel", staffId],
    queryFn: () => startInspectorConversation({ staffId }),
    enabled: inspectorChannel && senderRole === "supervisor" && staffId > 0,
    staleTime: Infinity,
    retry: (failureCount, error: any) =>
      error?.status === 401 || error?.status === 403 ? false : failureCount < 2,
  });
  const { data: inspectorAreas = [] } = useQuery({
    queryKey: ["/api/areas", "inspector-triage"],
    queryFn: () => listAreas(),
    enabled: inspectorChannel && senderRole === "supervisor" && staffId > 0,
    staleTime: 60_000,
  });
  const visibleConversations = useMemo(() => {
    if (inspectorChannel) {
      return inspectorChannelQuery.data ? [inspectorChannelQuery.data] : [];
    }
    return conversations;
  }, [conversations, inspectorChannel, inspectorChannelQuery.data]);
  const sessionExpired = (convosError as any)?.status === 401;

  useEffect(() => {
    const conversation = inspectorChannelQuery.data;
    if (!conversation) return;
    setMailboxView("inbox");
    setSelectedId(conversation.id);
    qc.setQueryData<ConversationSummary[]>(
      [CONVERSATIONS_KEY, staffId, "inbox"],
      (existing = []) => [
        conversation,
        ...existing.filter((item) => item.id !== conversation.id),
      ],
    );
  }, [inspectorChannelQuery.data, qc, staffId]);

  const { data: messages = [] } = useQuery({
    queryKey: [CONVERSATIONS_KEY, selectedId, "messages"],
    queryFn: () => listConversationMessages(selectedId!, { staffId }),
    enabled: staffId > 0 && selectedId !== null,
    refetchInterval: 5000,
  });

  const selectedConvo =
    visibleConversations.find((conversation) => conversation.id === selectedId) ?? null;

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

  useEffect(() => {
    setEditingMessageId(null);
    setEditDraft("");
    setEditError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!inspectorChannel) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [inspectorChannel]);

  const sendMutation = useMutation({
    mutationFn: (request: { body: string; clientRequestId: string }) =>
      sendConversationMessage(selectedId!, {
        senderId: staffId,
        body: request.body,
        clientRequestId: request.clientRequestId,
      }),
    onSuccess: (_message, request) => {
      if (pendingSendRef.current?.clientRequestId === request.clientRequestId) {
        pendingSendRef.current = null;
      }
      setDraft((current) => (current.trim() === request.body ? "" : current));
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ convoId, archived }: { convoId: number; archived: boolean }) =>
      setConversationArchived(convoId, { staffId, archived }),
    onMutate: () => setArchiveError(null),
    onSuccess: () => {
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    },
    onError: () => setArchiveError(t("messages.archiveFailed")),
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

  const triageMutation = useMutation({
    mutationFn: (request: { messageId: number; areaId: number; taskDate: string }) =>
      assignInspectorMessage(selectedId!, request.messageId, {
        staffId,
        areaId: request.areaId,
        taskDate: request.taskDate,
      }),
    onMutate: () => {
      setTriageError(null);
      setTriageNotice(null);
    },
    onSuccess: (assignment) => {
      setTriageMessageId(null);
      setTriageAreaId("");
      setTriageNotice(
        t("messages.inspectorAssignmentCreated", {
          staff: assignment.assignedStaffName,
          area: assignment.areaName,
        }),
      );
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY, selectedId, "messages"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks/special"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (error: any) => {
      setTriageError(
        error?.data?.error ?? error?.message ?? t("messages.inspectorAssignmentFailed"),
      );
    },
  });

  const handleArchive = () => {
    if (selectedId === null) return;
    archiveMutation.mutate({ convoId: selectedId, archived: mailboxView === "inbox" });
  };

  const handleSend = () => {
    const body = draft.trim();
    if (!body || selectedId === null || sendMutation.isPending) return;
    const pending = pendingSendRef.current;
    const clientRequestId =
      pending?.conversationId === selectedId && pending.body === body
        ? pending.clientRequestId
        : createClientRequestId();
    pendingSendRef.current = { conversationId: selectedId, body, clientRequestId };
    sendMutation.mutate({ body, clientRequestId });
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
    if (selectedId === null || editingMessageId === null || editMutation.isPending) return;
    setEditError(null);
    editMutation.mutate({ convoId: selectedId, msgId: editingMessageId, body });
  };

  const handleStarted = (convo: ConversationSummary) => {
    setShowNewConvo(false);
    setMailboxView("inbox");
    qc.setQueryData<ConversationSummary[]>(
      [CONVERSATIONS_KEY, staffId, "inbox"],
      (existing = []) => [convo, ...existing.filter((item) => item.id !== convo.id)],
    );
    setSelectedId(convo.id);
    qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
  };

  const changeMailbox = (nextView: MailboxView) => {
    if (nextView === mailboxView) return;
    setSelectedId(null);
    setArchiveError(null);
    setMailboxView(nextView);
  };

  const canStartConversation =
    senderRole === "admin" ||
    senderRole === "supervisor" ||
    senderRole === "inspector" ||
    senderRole === "staff";

  return (
    <div
      className={`${
        embedded ? "h-[70vh]" : "p-4 md:p-6 h-[calc(100vh-4rem)]"
      } flex flex-col`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-emerald-600" />
            {t(inspectorChannel ? "messages.inspectorChannelTitle" : "messages.title")}
          </h1>
          <p className="text-sm text-slate-500">
            {t(
              inspectorChannel
                ? "messages.inspectorChannelSubtitle"
                : "messages.subtitle",
            )}
          </p>
        </div>
        {canStartConversation && !inspectorChannel && (
          <button
            onClick={() => setShowNewConvo(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t("messages.newConversation")}</span>
          </button>
        )}
      </div>

      {!inspectorChannel && <section
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
      </section>}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* Conversation list */}
        <div
          className={`${selectedId !== null ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 overflow-hidden`}
        >
          <div className="grid grid-cols-2 gap-1 p-2 border-b border-slate-100" role="group" aria-label={t("messages.mailboxView")}>
            <button
              type="button"
              aria-pressed={mailboxView === "inbox"}
              onClick={() => changeMailbox("inbox")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                mailboxView === "inbox"
                  ? "bg-emerald-100 text-emerald-800"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Inbox className="w-3.5 h-3.5" />
              {t("messages.inbox")}
            </button>
            <button
              type="button"
              aria-pressed={mailboxView === "archived"}
              onClick={() => changeMailbox("archived")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                mailboxView === "archived"
                  ? "bg-slate-200 text-slate-800"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              {t("messages.archived")}
            </button>
          </div>
          {archiveError && (
            <p role="alert" className="px-3 py-2 text-xs text-rose-600 border-b border-rose-100 bg-rose-50">
              {archiveError}
            </p>
          )}
          <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
            {sessionExpired && (
              <div className="p-6 text-center text-amber-600 text-sm">{t("messages.sessionExpired")}</div>
            )}
            {convosLoading && (
              <div className="p-6 text-center text-slate-400 text-sm">{t("common.loading")}</div>
            )}
            {inspectorChannelQuery.error && (
              <div role="alert" className="p-4 text-center text-rose-600 text-sm">
                {t("messages.inspectorChannelUnavailable")}
              </div>
            )}
            {!convosLoading &&
              !inspectorChannelQuery.isLoading &&
              visibleConversations.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm">
                {mailboxView === "archived" ? (
                  <Archive className="w-10 h-10 mx-auto mb-3 opacity-30" />
                ) : (
                  <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                )}
                {t(
                  mailboxView === "archived"
                    ? "messages.noArchivedConversations"
                    : "messages.noConversations",
                )}
              </div>
            )}
            {visibleConversations.map((c) => (
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
                  onClick={handleArchive}
                  disabled={archiveMutation.isPending}
                  className="p-2 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 transition-colors"
                  aria-label={t(
                    mailboxView === "archived"
                      ? "messages.restoreConversation"
                      : "messages.archiveConversation",
                  )}
                  title={t(
                    mailboxView === "archived"
                      ? "messages.restoreConversation"
                      : "messages.archiveConversation",
                  )}
                >
                  {mailboxView === "archived" ? (
                    <ArchiveRestore className="w-4 h-4" />
                  ) : (
                    <Archive className="w-4 h-4" />
                  )}
                </button>
              </div>
              {archiveError && (
                <p role="alert" className="px-4 py-2 text-xs text-rose-600 border-b border-rose-100 bg-rose-50">
                  {archiveError}
                </p>
              )}
              {triageNotice && (
                <p role="status" className="px-4 py-2 text-xs font-semibold text-emerald-800 border-b border-emerald-100 bg-emerald-50">
                  {triageNotice}
                </p>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
                {messages.length === 0 && (
                  <div className="text-center text-slate-400 text-sm py-8">
                    {t("messages.startOfConversation")}
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.senderId === staffId;
                  const isEditing = editingMessageId === m.id;
                  const emailStatusKey =
                    m.emailDeliveryStatus === "pending"
                      ? "messages.emailPending"
                      : m.emailDeliveryStatus === "sending"
                        ? "messages.emailSending"
                        : m.emailDeliveryStatus === "retrying"
                          ? "messages.emailRetrying"
                          : m.emailDeliveryStatus === "accepted"
                            ? "messages.emailAccepted"
                            : m.emailDeliveryStatus === "failed"
                              ? "messages.emailFailed"
                              : m.emailDeliveryStatus === "disabled" ||
                                  m.emailDeliveryStatus === "not_configured"
                                ? "messages.emailUnavailable"
                                : null;
                  const isEmailAuditMessage =
                    m.isInboundEmail ||
                    m.emailDeliveryStatus !== "not_applicable" ||
                    Boolean(m.specialTaskId);
                  const messageActions = !isEditing && mine && !isEmailAuditMessage && (
                    <div className="flex items-center gap-0.5 shrink-0 mb-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(m.id, m.body)}
                        disabled={editMutation.isPending}
                        className="p-1 text-slate-400 hover:text-emerald-600 disabled:opacity-50"
                        aria-label={t("messages.editMessage")}
                        title={t("messages.editMessage")}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                  return (
                    <div key={m.id} className={`flex items-end gap-1.5 group ${mine ? "justify-end" : "justify-start"}`}>
                      {mine && messageActions}
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          mine
                            ? "bg-emerald-600 text-white rounded-br-md"
                            : "bg-white border border-slate-200 text-slate-800 rounded-bl-md"
                        }`}
                      >
                        {!mine && (
                          <p className="text-[11px] font-semibold text-emerald-700 mb-0.5">{m.senderName}</p>
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
                        <p className={`text-[10px] mt-1 ${mine ? "text-emerald-100" : "text-slate-400"}`}>
                          {format(new Date(m.createdAt), "MMM d, h:mm a")}
                          {mine && emailStatusKey ? ` · ${t(emailStatusKey)}` : ""}
                        </p>
                        {inspectorChannel && m.specialTaskId && (
                          <div
                            className={`mt-2 rounded-xl border p-2.5 text-xs ${
                              m.specialTaskCompleted
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                : m.specialTaskEscalatedAt
                                  ? "border-rose-200 bg-rose-50 text-rose-900"
                                  : "border-amber-200 bg-amber-50 text-amber-950"
                            }`}
                          >
                            <p className="flex items-center gap-1.5 font-bold">
                              {m.specialTaskCompleted ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : m.specialTaskEscalatedAt ? (
                                <AlertTriangle className="h-3.5 w-3.5" />
                              ) : (
                                <Clock3 className="h-3.5 w-3.5" />
                              )}
                              {m.specialTaskCompleted
                                ? t("messages.inspectorAssignmentCompleted")
                                : m.specialTaskEscalatedAt
                                  ? t("messages.inspectorAssignmentEscalated")
                                  : t("messages.inspectorAssignmentActive")}
                            </p>
                            <p className="mt-1">
                              {m.specialTaskAreaName} · {m.specialTaskAssignedStaffName}
                            </p>
                            {!m.specialTaskCompleted && m.specialTaskDueAt && (
                              <p className="mt-1 font-semibold">
                                {new Date(m.specialTaskDueAt).getTime() <= clockNow
                                  ? t("messages.inspectorAssignmentOverdue")
                                  : t("messages.inspectorAssignmentDue", {
                                      minutes: Math.max(
                                        1,
                                        Math.ceil(
                                          (new Date(m.specialTaskDueAt).getTime() - clockNow) /
                                            60_000,
                                        ),
                                      ),
                                    })}
                              </p>
                            )}
                          </div>
                        )}
                        {inspectorChannel &&
                          !mine &&
                          m.isInboundEmail &&
                          !m.specialTaskId &&
                          (triageMessageId === m.id ? (
                            <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-slate-800">
                              <p className="text-xs font-bold text-amber-900">
                                {t("messages.assignInspectorRequest")}
                              </p>
                              <label className="block text-[11px] font-semibold text-slate-600">
                                {t("messages.assignmentArea")}
                                <select
                                  value={triageAreaId}
                                  onChange={(event) => setTriageAreaId(event.target.value)}
                                  className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs"
                                >
                                  <option value="">{t("messages.chooseAssignmentArea")}</option>
                                  {inspectorAreas.map((area) => (
                                    <option key={area.id} value={area.id}>
                                      {area.terminal} — {area.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block text-[11px] font-semibold text-slate-600">
                                {t("messages.assignmentDate")}
                                <input
                                  type="date"
                                  value={triageDate}
                                  onChange={(event) => setTriageDate(event.target.value)}
                                  className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs"
                                />
                              </label>
                              {triageError && (
                                <p role="alert" className="text-[11px] font-semibold text-rose-700">
                                  {triageError}
                                </p>
                              )}
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTriageMessageId(null);
                                    setTriageError(null);
                                  }}
                                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-white"
                                >
                                  {t("common.cancel")}
                                </button>
                                <button
                                  type="button"
                                  disabled={!triageAreaId || !triageDate || triageMutation.isPending}
                                  onClick={() =>
                                    triageMutation.mutate({
                                      messageId: m.id,
                                      areaId: Number(triageAreaId),
                                      taskDate: triageDate,
                                    })
                                  }
                                  className="flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                                >
                                  {triageMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                                  {t("messages.assignClosestStaff")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setTriageMessageId(m.id);
                                setTriageAreaId("");
                                setTriageError(null);
                                setTriageNotice(null);
                              }}
                              className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              {t("messages.assignInspectorRequest")}
                            </button>
                          ))}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-slate-100 shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    rows={1}
                    maxLength={2000}
                    placeholder={t("messages.typeMessage")}
                    className="flex-1 resize-none rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 max-h-32"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim() || sendMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl p-2.5 transition-colors shrink-0"
                    aria-label={t("messages.send")}
                  >
                    <Send className="w-5 h-5" />
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
          onClose={() => setShowNewConvo(false)}
          onStarted={handleStarted}
        />
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

export default function Messages() {
  return <MessagesView />;
}
