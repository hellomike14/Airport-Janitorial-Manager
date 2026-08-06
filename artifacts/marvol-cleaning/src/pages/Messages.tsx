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
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listConversations,
  listConversationMessages,
  startConversation,
  startGroupConversation,
  sendConversationMessage,
  markConversationRead,
  listStaff,
  type ConversationSummary,
} from "@workspace/api-client-react";

const CONVERSATIONS_KEY = "/api/conversations";

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
  const [mode, setMode] = useState<DialogMode>("individual");
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

  const staffGroup = allowedRecipients.filter((s) => s.role === "staff");
  const supervisorGroup = allowedRecipients.filter((s) => s.role === "supervisor");
  const inspectorGroup = allowedRecipients.filter((s) => s.role === "inspector");
  const adminGroup = allowedRecipients.filter((s) => s.role === "admin");

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
                  {staffGroup.length > 0 && (
                    <button
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
                  {allowedRecipients.map((s) => (
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

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading: convosLoading, error: convosError } = useQuery({
    queryKey: [CONVERSATIONS_KEY, staffId],
    queryFn: () => listConversations({ staffId }),
    enabled: staffId > 0,
    refetchInterval: 15000,
    retry: (failureCount, error: any) => (error?.status === 401 ? false : failureCount < 2),
  });
  const sessionExpired = (convosError as any)?.status === 401;

  const { data: messages = [] } = useQuery({
    queryKey: [CONVERSATIONS_KEY, selectedId, "messages"],
    queryFn: () => listConversationMessages(selectedId!, { staffId }),
    enabled: staffId > 0 && selectedId !== null,
    refetchInterval: 5000,
  });

  const selectedConvo = conversations.find((c) => c.id === selectedId) ?? null;

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

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendConversationMessage(selectedId!, { senderId: staffId, body }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    },
  });

  const handleSend = () => {
    const body = draft.trim();
    if (!body || selectedId === null || sendMutation.isPending) return;
    sendMutation.mutate(body);
  };

  const handleStarted = (convo: ConversationSummary) => {
    setShowNewConvo(false);
    setSelectedId(convo.id);
    qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
  };

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

      <div className="flex-1 min-h-0 flex gap-4">
        {/* Conversation list */}
        <div
          className={`${selectedId !== null ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 overflow-hidden`}
        >
          <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
            {sessionExpired && (
              <div className="p-6 text-center text-amber-600 text-sm">{t("messages.sessionExpired")}</div>
            )}
            {convosLoading && (
              <div className="p-6 text-center text-slate-400 text-sm">{t("common.loading")}</div>
            )}
            {!convosLoading && conversations.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                {t("messages.noConversations")}
              </div>
            )}
            {conversations.map((c) => (
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
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
                {messages.length === 0 && (
                  <div className="text-center text-slate-400 text-sm py-8">
                    {t("messages.startOfConversation")}
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.senderId === staffId;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
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
                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`text-[10px] mt-1 ${mine ? "text-emerald-100" : "text-slate-400"}`}>
                          {format(new Date(m.createdAt), "MMM d, h:mm a")}
                        </p>
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
    </div>
  );
}
