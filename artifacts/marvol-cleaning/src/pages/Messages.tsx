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
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listConversations,
  listConversationMessages,
  startConversation,
  sendConversationMessage,
  markConversationRead,
  listStaff,
  type ConversationSummary,
} from "@workspace/api-client-react";

const CONVERSATIONS_KEY = "/api/conversations";

function roleIcon(role: string) {
  if (role === "admin") return <Shield className="w-3.5 h-3.5 text-violet-500" />;
  if (role === "supervisor") return <Users className="w-3.5 h-3.5 text-emerald-500" />;
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

  const { data: staffList = [] } = useQuery({
    queryKey: ["/api/staff"],
    queryFn: () => listStaff(),
    enabled: showNewConvo,
  });

  const selectedConvo = conversations.find((c) => c.id === selectedId) ?? null;

  // Opening a conversation (or receiving new messages while it is open)
  // marks it read, then refreshes the unread counters everywhere.
  const unreadInSelected = useMemo(
    () => messages.some((m) => m.senderId !== staffId && !m.isRead),
    [messages, staffId]
  );
  useEffect(() => {
    if (selectedId === null || !unreadInSelected) return;
    markConversationRead(selectedId, { staffId }).then(() => {
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    });
  }, [selectedId, unreadInSelected, staffId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedId]);

  const startMutation = useMutation({
    mutationFn: (recipientId: number) => startConversation({ staffId, recipientId }),
    onSuccess: (convo: ConversationSummary) => {
      setShowNewConvo(false);
      setSelectedId(convo.id);
      qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
    },
  });

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

  // Recipient picker, filtered by the sender's real role:
  // admin      → staff, supervisor
  // supervisor → staff, admin, inspector
  // inspector  → supervisor
  // staff      → supervisor
  const allowedRecipients = staffList.filter((s) => {
    if (s.id === staffId) return false;
    if (senderRole === "admin") return s.role === "staff" || s.role === "supervisor";
    if (senderRole === "supervisor") return s.role === "staff" || s.role === "admin" || s.role === "inspector";
    if (senderRole === "inspector") return s.role === "supervisor";
    if (senderRole === "staff") return s.role === "supervisor";
    return false;
  });

  const canStartConversation = senderRole === "admin" || senderRole === "supervisor" || senderRole === "staff";

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
              <div className="p-6 text-center text-amber-600 text-sm">
                {t("messages.sessionExpired")}
              </div>
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
                <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-sm font-bold shrink-0">
                  {initialsOf(c.otherStaffName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-800 text-sm truncate">{c.otherStaffName}</span>
                    {roleIcon(c.otherStaffRole)}
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {c.lastMessage ?? t("messages.noMessagesYet")}
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
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold">
                  {initialsOf(selectedConvo.otherStaffName)}
                </div>
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{selectedConvo.otherStaffName}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    {roleIcon(selectedConvo.otherStaffRole)}
                    {t(`roles.${selectedConvo.otherStaffRole}`)}
                  </p>
                </div>
              </div>

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

      {/* New conversation picker */}
      {showNewConvo && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowNewConvo(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="font-semibold text-slate-800">{t("messages.newConversation")}</p>
              <button onClick={() => setShowNewConvo(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-50">
              {allowedRecipients.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-sm">{t("messages.noRecipients")}</div>
              )}
              {allowedRecipients.map((s) => (
                <button
                  key={s.id}
                  disabled={startMutation.isPending}
                  onClick={() => startMutation.mutate(s.id)}
                  className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold">
                    {initialsOf(s.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{s.name}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      {roleIcon(s.role)}
                      {t(`roles.${s.role}`)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
