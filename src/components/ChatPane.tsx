import React, { useRef, useEffect, useState } from "react";
import {
  Search,
  MoreVertical,
  Paperclip,
  Phone,
  Video,
  Download,
  Check,
  CheckCheck,
  X,
  FileText,
  ArrowDown,
  ZoomIn,
  CornerUpLeft,
  Users,
  UserPlus,
  User,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Copy,
  VolumeX,
  Lock,
  ExternalLink,
  MapPin,
  Smile,
  ArrowLeft,
  RotateCw,
  PhoneMissed,
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  Zap
} from "lucide-react";
import { Contact, Message, GroupParticipant } from "../types";
import { AudioPlayer } from "./AudioPlayer";

interface ChatPaneProps {
  contact: Contact;
  messages: Message[];
  isDark: boolean;
  batteryStatus?: { value: number; isCharging: boolean } | null;
  onSendMessage: (
    text: string,
    type: "text" | "image" | "voice" | "file" | "video" | "sticker" | "contact" | "location" | "poll",
    fileData?: { name: string; size: string; url: string },
    contactCard?: { name: string; phone: string; avatar?: string; about?: string },
    locationData?: { latitude: number; longitude: number; name: string; address?: string },
    pollData?: { question: string; options: { id: string; text: string; votes: string[] }[] }
  ) => void;
  onTranscribe: (messageId: string) => void;
  onOpenSearch: () => void;
  scrollToMessageId: string | null;
  clearScrollToMessage: () => void;

  // Custom callback links
  onSetQuotedMessage: (msg: Message) => void;
  onUpdatePollVote: (msgId: string, optionId: string) => void;
  onAddReaction: (msgId: string, emoji: string) => void;
  onUpdateContactSettings: (contactId: string, updates: Partial<Contact>) => void;
  onSelectContactById: (id: string | null) => void;
  onReloadHistory: (contactId: string, count?: number) => void;
  onViewProfile?: (contactId: string) => void;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  contact,
  messages,
  isDark,
  batteryStatus: batteryStatusProp,
  onSendMessage,
  onTranscribe,
  onOpenSearch,
  scrollToMessageId,
  clearScrollToMessage,
  onSetQuotedMessage,
  onUpdatePollVote,
  onAddReaction,
  onUpdateContactSettings,
  onSelectContactById,
  onReloadHistory,
  onViewProfile,
}) => {
  const [battery, setBattery] = useState<{ value: number; isCharging: boolean }>(() => {
    return batteryStatusProp || { value: 85, isCharging: false };
  });

  useEffect(() => {
    if (batteryStatusProp) {
      setBattery(batteryStatusProp);
    } else if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery().then((batteryObj: any) => {
        setBattery({
          value: Math.round(batteryObj.level * 100),
          isCharging: Boolean(batteryObj.charging),
        });
      }).catch(() => {});
    }
  }, [batteryStatusProp]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [activeZoomImage, setActiveZoomImage] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [showGroupDrawer, setShowGroupDrawer] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [hasReachedTop, setHasReachedTop] = useState(false);
  const prevMsgLengthRef = useRef(messages.length);

  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Scroll Anchoring refs
  const previousScrollHeightRef = useRef<number>(0);
  const previousScrollTopRef = useRef<number>(0);
  const lastContactIdRef = useRef<string | null>(null);
  const lastMessagesLengthRef = useRef<number>(0);
  const firstMessageIdRef = useRef<string | null>(null);

  // Reset loading indicators on message updates
  useEffect(() => {
    if (loadingOlder && messages.length <= prevMsgLengthRef.current) {
      // If we requested older messages but the total messages didn't increase,
      // we have reached the beginning of the 3-month history for this chat!
      setHasReachedTop(true);
    }
    prevMsgLengthRef.current = messages.length;
    setLoadingOlder(false);
    setIsReloading(false);
  }, [messages, loadingOlder]);

  useEffect(() => {
    // Reset hasReachedTop when active contact changes
    setHasReachedTop(false);
    prevMsgLengthRef.current = messages.length;
  }, [contact.id]);

  // Robust, anchor-aware scroll-management system
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const isContactChanged = contact.id !== lastContactIdRef.current;
    
    if (isContactChanged) {
      // Switch contact: Scroll to bottom immediately
      container.scrollTop = container.scrollHeight;
      lastContactIdRef.current = contact.id;
      lastMessagesLengthRef.current = messages.length;
      firstMessageIdRef.current = messages[0]?.id || null;
      return;
    }

    // Same contact: messages modified
    const currentFirstMsgId = messages[0]?.id || null;
    const previousFirstMsgId = firstMessageIdRef.current;
    
    if (currentFirstMsgId !== previousFirstMsgId && previousFirstMsgId !== null) {
      // Older messages were prepended! Adjust scroll position to maintain anchor.
      const newScrollHeight = container.scrollHeight;
      const scrollDiff = newScrollHeight - previousScrollHeightRef.current;
      container.scrollTop = previousScrollTopRef.current + scrollDiff;
    } else {
      // Message list grew at the bottom (new sent/received messages)
      const lastMsg = messages[messages.length - 1];
      const isSentByMe = lastMsg?.sender === "me";
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 250;
      
      if (isSentByMe || isNearBottom) {
        container.scrollTop = container.scrollHeight;
      }
    }

    // Keep state tracking refs up-to-date
    lastMessagesLengthRef.current = messages.length;
    firstMessageIdRef.current = currentFirstMsgId;
  }, [messages, contact.id]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    
    // Save scroll state before potential prepend
    previousScrollHeightRef.current = scrollHeight;
    previousScrollTopRef.current = scrollTop;

    const isFar = scrollHeight - scrollTop - clientHeight > 300;
    setShowScrollDown(isFar);

    // Auto-trigger load older messages only when not already at top, not loading, and history remaining
    if (
      scrollTop < 5 &&
      messages.length >= 10 &&
      !loadingOlder &&
      !hasReachedTop &&
      contact.id !== "meta-ai" &&
      !contact.id.startsWith("group_")
    ) {
      console.log("Scrolled to top. Auto-fetching older chat history...");
      setLoadingOlder(true);
      onReloadHistory(contact.id, messages.length + 50);
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    if (scrollToMessageId && messageRefs.current[scrollToMessageId]) {
      const element = messageRefs.current[scrollToMessageId];
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("bg-yellow-400/30", "dark:bg-yellow-500/20");
        setTimeout(() => {
          element.classList.remove("bg-yellow-400/30", "dark:bg-yellow-500/20");
          clearScrollToMessage();
        }, 2000);
      }
    }
  }, [scrollToMessageId, clearScrollToMessage]);

  const renderStatusTicks = (status: Message["status"]) => {
    if (status === "sent") return <Check size={14} className="text-gray-400" />;
    if (status === "delivered") return <CheckCheck size={14} className="text-gray-400" />;
    if (status === "read") return <CheckCheck size={14} className="text-[#53bdeb]" />;
    return null;
  };

  // Group Member Administration
  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;
    const updatedParticipants = [
      ...(contact.participants || []),
      {
        id: `user_${Date.now()}`,
        name: newMemberName.trim(),
        role: "member" as const,
      },
    ];
    onUpdateContactSettings(contact.id, { participants: updatedParticipants });
    setNewMemberName("");
  };

  const handleKickMember = (memberId: string) => {
    const updated = (contact.participants || []).filter((p) => p.id !== memberId);
    onUpdateContactSettings(contact.id, { participants: updated });
  };

  const handleToggleAdmin = (memberId: string, currentRole: "admin" | "member") => {
    const updated = (contact.participants || []).map((p) =>
      p.id === memberId ? { ...p, role: (currentRole === "admin" ? "member" : "admin") as "admin" | "member" } : p
    );
    onUpdateContactSettings(contact.id, { participants: updated });
  };

  const handleCopyInviteLink = () => {
    if (contact.inviteLink) {
      navigator.clipboard.writeText(contact.inviteLink);
      alert("Group invite link copied to clipboard!");
    }
  };

  // Helper calculation for polls
  const getPollResults = (pollData: Message["pollData"]) => {
    if (!pollData) return { totalVotes: 0, optionsWithPercentages: [] };
    const totalVotes = pollData.options.reduce((acc, opt) => acc + opt.votes.length, 0);
    const optionsWithPercentages = pollData.options.map((opt) => {
      const percentage = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
      return { ...opt, percentage };
    });
    return { totalVotes, optionsWithPercentages };
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden relative">
      {/* Primary Conversation Screen */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header Panel */}
        <div
          onClick={() => {
            if (onViewProfile) {
              onViewProfile(contact.id);
            } else {
              setShowGroupDrawer(true);
            }
          }}
          className={`flex items-center justify-between px-6 py-3 border-b shrink-0 select-none z-10 cursor-pointer hover:opacity-95 transition-opacity ${
            isDark ? "bg-[#202c33] border-gray-800 text-white" : "bg-[#f0f2f5] border-gray-200 text-gray-800"
          }`}
        >
          <div className="flex items-center gap-3">
            {/* Back Button for Mobile Viewports */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectContactById(null);
              }}
              className="md:hidden p-1.5 -ml-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-300 transition-colors cursor-pointer shrink-0"
              title="Back to Chats List"
            >
              <ArrowLeft size={20} />
            </button>

            {/* Avatar block */}
            <div
              className={`w-10 h-10 rounded-full overflow-hidden flex items-center justify-center border shrink-0 ${
                contact.id === "meta-ai"
                  ? "bg-gradient-to-tr from-purple-500 via-pink-500 to-blue-500 border-none animate-pulse"
                  : "bg-gray-200 border-black/5 dark:border-white/5"
              }`}
            >
              {contact.id === "meta-ai" ? (
                <span className="text-white font-extrabold font-mono text-sm">M</span>
              ) : contact.isGroup ? (
                <span className="text-emerald-600 font-extrabold text-sm font-mono">GP</span>
              ) : contact.avatar && contact.avatar.startsWith("http") ? (
                <div className="w-full h-full relative flex items-center justify-center">
                  <img
                    src={contact.avatar || null}
                    alt={contact.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                  <span className="text-gray-500 font-semibold text-sm absolute inset-0 flex items-center justify-center -z-10">
                    {(contact.name && isNaN(Number(contact.name)) ? contact.name : "U").slice(0, 2).toUpperCase()}
                  </span>
                </div>
              ) : (
                <span className="text-gray-500 font-semibold text-sm flex items-center justify-center">
                  {contact.name?.startsWith("+") || contact.phoneNumber ? (
                    <User size={20} className="text-gray-400 dark:text-gray-500" />
                  ) : (
                    (contact.name && isNaN(Number(contact.name)) ? contact.name : "User").slice(0, 2).toUpperCase()
                  )}
                </span>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm leading-tight flex items-center gap-1">
                  {contact.name && isNaN(Number(contact.name)) ? contact.name : (contact.phoneNumber || "WhatsApp User")}
                  {contact.verified && <span className="text-[#53bdeb] text-xs">✔️</span>}
                  {contact.isMuted && <VolumeX size={12} className="text-gray-400" />}
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  ৩ মাসের হিস্ট্রি সিঙ্কড
                </span>
              </div>
              <p className="text-[11px] opacity-60 leading-none mt-0.5">
                {contact.status === "typing..." ? (
                  <span className="text-[#00a884] font-medium animate-pulse">typing...</span>
                ) : contact.status === "online" ? (
                  <span className="text-[#00a884] font-medium">online</span>
                ) : contact.isGroup ? (
                  `${contact.participants?.length || 0} participants • Click for group info`
                ) : (
                  contact.about
                )}
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3 sm:gap-4" onClick={(e) => e.stopPropagation()}>
            {/* Phone Battery Status Indicator Icon */}
            <div className="relative group flex items-center">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all select-none cursor-help shadow-2xs ${
                  isDark
                    ? "bg-[#182229] border-gray-700/60 hover:bg-[#202c33]"
                    : "bg-white border-gray-200 hover:bg-gray-50 text-gray-700"
                }`}
                title={`Phone Battery: ${battery.value}%${battery.isCharging ? " (Charging ⚡)" : ""}`}
              >
                <div className="relative flex items-center justify-center">
                  {battery.isCharging ? (
                    <BatteryCharging size={18} className="text-[#00a884] dark:text-[#00e676] animate-pulse" />
                  ) : battery.value <= 15 ? (
                    <BatteryWarning size={18} className="text-red-500 animate-bounce" />
                  ) : battery.value <= 35 ? (
                    <BatteryLow size={18} className="text-amber-500" />
                  ) : battery.value <= 70 ? (
                    <BatteryMedium size={18} className="text-[#00a884] dark:text-[#00e676]" />
                  ) : (
                    <BatteryFull size={18} className="text-[#00a884] dark:text-[#00e676]" />
                  )}
                  {battery.isCharging && (
                    <Zap size={9} className="absolute text-yellow-400 fill-yellow-400 -top-1 -right-1" />
                  )}
                </div>
                <span
                  className={`font-mono text-[11px] font-bold ${
                    battery.isCharging
                      ? "text-[#00a884] dark:text-[#00e676]"
                      : battery.value <= 15
                      ? "text-red-500"
                      : battery.value <= 35
                      ? "text-amber-500"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {battery.value}%
                </span>
              </div>

              {/* Tooltip Hover Badge */}
              <div className="absolute right-0 top-full mt-1.5 hidden group-hover:flex flex-col items-end z-50 pointer-events-none">
                <div
                  className={`px-3 py-1.5 rounded-lg shadow-xl border text-[11px] whitespace-nowrap flex items-center gap-2 ${
                    isDark
                      ? "bg-[#233138] border-gray-700 text-[#e9edef]"
                      : "bg-[#111b21] border-gray-800 text-white"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      battery.isCharging
                        ? "bg-emerald-400 animate-ping"
                        : battery.value <= 15
                        ? "bg-red-400 animate-pulse"
                        : "bg-emerald-400"
                    }`}
                  />
                  <span>
                    Phone Battery: <b>{battery.value}%</b>{" "}
                    {battery.isCharging ? "• Charging ⚡" : "• Synced"}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setIsReloading(true);
                onReloadHistory(contact.id, messages.length + 100);
                setTimeout(() => setIsReloading(false), 3000); // fallback reset
              }}
              disabled={isReloading}
              className={`p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-300 transition-colors cursor-pointer ${isReloading ? "animate-spin text-[#00a884]" : ""}`}
              title="পুরনো ৩ মাসের চ্যাট, ভয়েস ও মিডিয়া রিলোড ও সিঙ্ক করুন (Reload / Sync History)"
            >
              <RotateCw size={17} />
            </button>
            <button
              onClick={onOpenSearch}
              className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-300 transition-colors cursor-pointer"
              title="Search Messages"
            >
              <Search size={18} />
            </button>
            <button
              className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-300 transition-colors cursor-pointer"
              title="Audio Call"
              onClick={() => alert(`Initiating secure multi-device audio call with ${contact.name}...`)}
            >
              <Phone size={18} />
            </button>
            <button
              className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-300 transition-colors cursor-pointer"
              title="Video Call"
              onClick={() => alert(`Initiating secure multi-device video call with ${contact.name}...`)}
            >
              <Video size={18} />
            </button>
          </div>
        </div>

        {/* Messages Canvas */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-4 space-y-4 whatsapp-chat-bg"
        >
          {contact.isBlocked && (
            <div className="flex justify-center select-none">
              <span className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs px-3 py-1.5 rounded-full font-semibold flex items-center gap-1.5 shadow-sm">
                <ShieldAlert size={12} /> This contact is blocked. You cannot send or receive messages.
              </span>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-xs opacity-40 italic select-none">
              <span>No messages here. Share media, start polls, or type a text!</span>
            </div>
          ) : (
            <>
              {/* 3-Month Synced Security Notice Banner */}
              <div className="flex justify-center select-none my-2">
                <div className="bg-[#ffeecd] dark:bg-[#182229] text-[#54656f] dark:text-[#ffd279] text-[11px] px-3.5 py-2 rounded-lg shadow-2xs max-w-lg text-center leading-relaxed border border-yellow-500/20">
                  <span className="font-semibold flex items-center justify-center gap-1.5">
                    <Lock size={12} className="text-emerald-600 dark:text-emerald-400" /> মেসেজ ও কল এন্ড-টু-এন্ড এনক্রিপ্টেড
                  </span>
                  <p className="text-[10px] opacity-80 mt-0.5">
                    লগইন তারিখ থেকে গত ৩ মাসের সকল চ্যাট হিস্ট্রি (মেসেজ, ভয়েস রেকর্ড, ছবি, ভিডিও, ফাইল ও কল) সফলভাবে সিঙ্ক রয়েছে।
                  </p>
                </div>
              </div>

              {/* Load older history manual trigger */}
              {contact.id !== "meta-ai" && !contact.id.startsWith("group_") && (
                <div className="flex flex-col items-center justify-center py-2 mb-4">
                  {hasReachedTop ? (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 bg-black/5 dark:bg-white/5 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
                      ✓ এই চ্যাটের গত ৩ মাসের সকল মেসেজ লোড হয়েছে
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setLoadingOlder(true);
                          onReloadHistory(contact.id, messages.length + 50);
                        }}
                        disabled={loadingOlder}
                        className="px-4 py-1.5 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-xs text-[#00a884] font-medium transition-colors border border-black/5 dark:border-white/5 cursor-pointer shadow-sm flex items-center gap-1.5"
                      >
                        <RotateCw size={11} className={loadingOlder ? "animate-spin" : ""} />
                        {loadingOlder ? "পুরনো মেসেজ লোড হচ্ছে..." : "পুরনো চ্যাট ও মেসেজ লোড করুন (Load Older History)"}
                      </button>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                        মোবাইল থেকে আরও পুরনো চ্যাট হিস্ট্রি আনতে ওপরের দিকে স্ক্রোল করুন বা বাটনটি চাপুন
                      </p>
                    </>
                  )}
                </div>
              )}

              {messages.map((msg) => {
                const isMe = msg.sender === "me";
                const isHovered = hoveredMessageId === msg.id;

                return (
                <div
                  key={msg.id}
                  ref={(el) => {
                    messageRefs.current[msg.id] = el;
                  }}
                  onMouseEnter={() => setHoveredMessageId(msg.id)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                  className={`flex w-full relative group transition-all duration-300 ${isMe ? "justify-end" : "justify-start"}`}
                >
                  {/* Bubble body */}
                  <div
                    className={`max-w-[85%] md:max-w-[70%] lg:max-w-[55%] rounded-lg px-3 py-2 shadow-xs relative text-sm flex flex-col gap-1 border border-black/5 ${
                      isMe
                        ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] bubble-sent"
                        : "bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] bubble-received"
                    }`}
                  >
                    {/* Quoted source layout if msg is a reply */}
                    {msg.replyTo && (
                      <div className="mb-1 p-1.5 rounded text-xs border-l-4 border-emerald-500 bg-black/10 dark:bg-white/5 cursor-pointer truncate max-w-sm">
                        <span className="font-bold text-[10px] text-emerald-500 block">
                          Quoting {msg.replyTo.sender === "me" ? "yourself" : "contact"}
                        </span>
                        <p className="opacity-80 truncate">{msg.replyTo.text}</p>
                      </div>
                    )}

                    {/* RENDER DYNAMIC WHATSAPP CLONE COMPONENT SPECIFICS */}

                    {/* TYPE 1: STICKER */}
                    {msg.type === "sticker" && msg.fileUrl && (
                      <div className="flex justify-center p-1 select-none">
                        <img
                          src={msg.fileUrl || null}
                          alt="sticker"
                          className="w-24 h-24 object-contain animate-bounce"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    {/* TYPE 2: FILE / DOCUMENT */}
                    {msg.type === "file" && (
                      <div className="flex items-center gap-3 p-2 bg-black/5 dark:bg-white/5 rounded-md border border-black/10 dark:border-white/10 mb-1 min-w-[210px]">
                        <div className="p-2.5 bg-red-500 rounded text-white shrink-0 shadow-xs">
                          <FileText size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-xs truncate" title={msg.fileName}>{msg.fileName || "Document"}</h4>
                          <div className="flex items-center gap-1.5 text-[10px] opacity-65">
                            <span>{msg.fileSize || "14 KB"}</span>
                            {msg.isHeavy && (
                              <span className="bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold px-1 rounded text-[9px]">
                                Large File
                              </span>
                            )}
                          </div>
                        </div>
                        {msg.fileUrl && (
                          <a
                            href={msg.fileUrl}
                            download={msg.fileName || "download"}
                            className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[#00a884] dark:text-[#53bdeb] shrink-0 cursor-pointer"
                            title="Download document"
                          >
                            <Download size={16} />
                          </a>
                        )}
                      </div>
                    )}

                    {/* TYPE 3: IMAGE */}
                    {msg.type === "image" && msg.fileUrl && (
                      <div className="relative group rounded-md overflow-hidden mb-1 border border-black/10 dark:border-white/10 select-none">
                        <img
                          src={msg.fileUrl || null}
                          alt="Shared File"
                          className="max-h-64 object-cover w-full cursor-pointer hover:brightness-95 transition-all"
                          onClick={() => setActiveZoomImage(msg.fileUrl || null)}
                          referrerPolicy="no-referrer"
                        />
                        <button
                          onClick={() => setActiveZoomImage(msg.fileUrl || null)}
                          className="absolute bottom-2 right-2 bg-black/60 p-1.5 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Zoom"
                        >
                          <ZoomIn size={14} />
                        </button>
                      </div>
                    )}

                    {/* TYPE 4: VIDEO */}
                    {msg.type === "video" && (
                      <div className="relative rounded-md overflow-hidden mb-1 border border-black/10 dark:border-white/10 select-none bg-black">
                        {msg.fileUrl ? (
                          <video
                            src={msg.fileUrl}
                            controls
                            preload="metadata"
                            className="max-h-64 w-full rounded"
                          />
                        ) : (
                          <div className="p-4 flex flex-col items-center justify-center gap-2 text-white text-xs">
                            <Video size={24} />
                            <span>Video clip ({msg.fileSize || "Auto-synced"})</span>
                          </div>
                        )}
                        {msg.fileSize && (
                          <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                            {msg.fileSize}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TYPE 5: VOICE */}
                    {msg.type === "voice" && (
                      <AudioPlayer message={msg} isDark={isDark} onTranscribe={onTranscribe} />
                    )}

                    {/* TYPE 9: CALL RECORD (VOICE / VIDEO CALL) */}
                    {msg.type === "call" && (
                      <div className="flex items-center gap-3 p-2.5 bg-black/5 dark:bg-white/5 rounded-md border border-black/10 dark:border-white/10 mb-1 min-w-[220px]">
                        <div className={`p-2 rounded-full text-white shrink-0 shadow-xs ${
                          msg.callData?.status === "missed" ? "bg-red-500" : "bg-emerald-600"
                        }`}>
                          {msg.callData?.callType === "video" ? (
                            <Video size={16} />
                          ) : msg.callData?.status === "missed" ? (
                            <PhoneMissed size={16} />
                          ) : (
                            <Phone size={16} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-xs truncate">
                            {msg.text || (msg.callData?.callType === "video" ? "Video call" : "Voice call")}
                          </h4>
                          <p className="text-[10px] opacity-60">
                            {msg.callData?.status === "missed" ? "Missed call" : (msg.callData?.duration ? `Duration: ${msg.callData.duration}` : "Completed")}
                          </p>
                        </div>
                        <button
                          onClick={() => alert(`Initiating secure call to ${contact.name}...`)}
                          className="px-2.5 py-1 bg-[#00a884] hover:bg-[#008069] text-white text-[11px] font-semibold rounded transition-colors cursor-pointer shrink-0"
                        >
                          Call back
                        </button>
                      </div>
                    )}

                    {/* TYPE 6: LOCATION */}
                    {msg.type === "location" && msg.locationData && (
                      <div className="flex flex-col gap-1.5 mb-1 p-2 rounded bg-black/10 dark:bg-white/5 border border-black/10 dark:border-white/10">
                        <div className="flex items-center gap-2 text-red-500 font-bold text-xs">
                          <MapPin size={16} />
                          <span>Location Shared</span>
                        </div>
                        <div className="text-xs">
                          <h4 className="font-bold">{msg.locationData.name}</h4>
                          <p className="opacity-70 text-[10px] mt-0.5">{msg.locationData.address}</p>
                        </div>
                        <div className="text-[10px] font-mono opacity-50">
                          Lat: {msg.locationData.latitude.toFixed(4)}, Lng: {msg.locationData.longitude.toFixed(4)}
                        </div>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${msg.locationData.latitude},${msg.locationData.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 py-1.5 bg-[#00a884] hover:bg-[#008069] text-white font-bold text-center text-xs rounded flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                        >
                          <span>Open in Google Maps</span>
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    )}

                    {/* TYPE 7: CONTACT CARD */}
                    {msg.type === "contact" && msg.contactCard && (
                      <div className="flex flex-col gap-2 p-2.5 rounded bg-black/10 dark:bg-white/5 border border-black/10 dark:border-white/10 min-w-[200px]">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-full bg-gray-200 border border-black/10 overflow-hidden flex items-center justify-center">
                            {msg.contactCard.avatar ? (
                              <img src={msg.contactCard.avatar || null} alt="Shared Contact" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <User size={16} className="text-gray-500" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs truncate">{msg.contactCard.name}</h4>
                            <p className="text-[10px] opacity-60 truncate">{msg.contactCard.phone}</p>
                          </div>
                        </div>
                        <p className="text-[10px] italic opacity-70 border-t border-black/10 dark:border-white/10 pt-1.5 truncate">
                          {msg.contactCard.about || "Available"}
                        </p>
                        <button
                          onClick={() => {
                            // Find matching contact or simulate a redirect
                            alert(`Redirecting to conversation with ${msg.contactCard?.name}...`);
                          }}
                          className="w-full mt-1.5 py-1.5 border border-[#00a884] hover:bg-[#00a884]/15 text-[#00a884] font-bold text-xs rounded transition-colors cursor-pointer text-center"
                        >
                          Message
                        </button>
                      </div>
                    )}

                    {/* TYPE 8: POLLS (ACTIVE INTERACTIVE VOTING!) */}
                    {msg.type === "poll" && msg.pollData && (() => {
                      const { totalVotes, optionsWithPercentages } = getPollResults(msg.pollData);
                      return (
                        <div className="flex flex-col gap-2 p-2 bg-black/10 dark:bg-white/5 rounded border border-black/15 dark:border-white/15 min-w-[240px]">
                          <div className="font-bold text-xs border-b pb-1.5 border-black/10 dark:border-white/10">
                            📊 {msg.pollData.question}
                          </div>
                          <div className="space-y-2 mt-1">
                            {optionsWithPercentages.map((opt) => {
                              const didIVote = opt.votes.includes("You (Owner)");
                              return (
                                <button
                                  key={opt.id}
                                  onClick={() => onUpdatePollVote(msg.id, opt.id)}
                                  className={`w-full text-left p-2 rounded relative overflow-hidden flex flex-col gap-0.5 border text-xs transition-all cursor-pointer ${
                                    didIVote
                                      ? "border-emerald-500/40 bg-emerald-500/10"
                                      : "border-black/5 hover:bg-black/5 dark:hover:bg-white/5"
                                  }`}
                                >
                                  {/* Percentage background filler */}
                                  <div
                                    className="absolute left-0 top-0 bottom-0 bg-emerald-500/15 transition-all duration-500 ease-out z-0"
                                    style={{ width: `${opt.percentage}%` }}
                                  />
                                  <div className="flex justify-between items-center relative z-10 w-full font-semibold">
                                    <span>{opt.text}</span>
                                    <span>{opt.votes.length} votes</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[9px] opacity-60 relative z-10 mt-0.5">
                                    <span className="truncate max-w-[150px]">
                                      {opt.votes.length > 0 ? opt.votes.join(", ") : "No votes"}
                                    </span>
                                    <span>{opt.percentage}%</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          <div className="text-[9px] text-center opacity-55 border-t border-black/5 pt-1.5">
                            Total: {totalVotes} votes • Click choice to vote
                          </div>
                        </div>
                      );
                    })()}

                    {/* GENERAL TEXT DESCRIPTION FOR BASIC MESSAGE CHATS */}
                    {msg.type === "text" && (
                      <p className="whitespace-pre-wrap break-words leading-relaxed text-sm pr-12">
                        {msg.text}
                      </p>
                    )}

                    {/* Reaction Pill Indicator Overlay */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="absolute -bottom-2.5 right-2 flex items-center gap-0.5 bg-white dark:bg-[#222e35] px-1.5 py-0.5 rounded-full shadow border border-black/10 text-xs select-none z-10 scale-95">
                        {Array.from(new Set(msg.reactions.map((r) => r.emoji))).slice(0, 3).map((emoji, idx) => (
                          <span key={idx}>{emoji}</span>
                        ))}
                        <span className="text-[9px] font-bold opacity-60 pl-0.5">{msg.reactions.length}</span>
                      </div>
                    )}

                    {/* Metadata indicators */}
                    <div className="absolute bottom-1 right-2 flex items-center gap-1 text-[9px] opacity-50 select-none pointer-events-none">
                      <span>{msg.timestamp}</span>
                      {isMe && renderStatusTicks(msg.status)}
                    </div>
                  </div>

                  {/* Reply and reaction hover shortcuts panel */}
                  {isHovered && (
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 p-1 bg-white dark:bg-[#202c33] rounded-full shadow-lg border border-black/10 z-20 ${
                        isMe ? "right-full mr-2" : "left-full ml-2"
                      }`}
                      style={{ animation: "scaleUp 0.1s ease-out" }}
                    >
                      {/* 1. Emoji picker popup row */}
                      {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => onAddReaction(msg.id, emoji)}
                          className="hover:scale-125 transition-transform text-sm px-1 cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}

                      {/* 2. Quoted Reply action */}
                      <button
                        onClick={() => onSetQuotedMessage(msg)}
                        className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full text-emerald-500 cursor-pointer"
                        title="Quote and Reply"
                      >
                        <CornerUpLeft size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
          )}
        </div>

        {/* Scroll Down Floating Indicator */}
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            className={`absolute bottom-16 right-6 p-2.5 rounded-full shadow-lg border transition-all z-20 cursor-pointer hover:scale-105 ${
              isDark
                ? "bg-[#202c33] border-gray-700 text-[#00a884] hover:bg-[#2a3942]"
                : "bg-white border-gray-200 text-[#00a884] hover:bg-gray-100"
            }`}
          >
            <ArrowDown size={18} />
          </button>
        )}
      </div>

      {/* COLLAPSIBLE SIDEBAR: GROUP DETAILS / CONTACT INFO DRAWER */}
      {showGroupDrawer && (
        <div
          className={`w-[320px] md:w-[350px] h-full border-l flex flex-col shrink-0 select-none z-30 relative ${
            isDark ? "bg-[#111b21] border-gray-800 text-white" : "bg-white border-gray-200 text-gray-800"
          }`}
          style={{ animation: "slideLeft 0.15s ease-out" }}
        >
          {/* Drawer Header */}
          <div
            className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
              isDark ? "bg-[#202c33] border-gray-800" : "bg-[#f0f2f5] border-gray-200"
            }`}
          >
            <h3 className="font-bold text-sm">
              {contact.isGroup ? "Group Details" : "Contact Information"}
            </h3>
            <button
              onClick={() => setShowGroupDrawer(false)}
              className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* 1. Large Avatar Area */}
            <div className="flex flex-col items-center text-center pb-4 border-b border-black/5 dark:border-white/5">
              <div
                className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold mb-3 overflow-hidden ${
                  contact.id === "meta-ai"
                    ? "bg-gradient-to-tr from-purple-500 via-pink-500 to-blue-500"
                    : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                }`}
              >
                {contact.id === "meta-ai" ? (
                  "M"
                ) : contact.avatar && contact.avatar.startsWith("http") ? (
                  <img src={contact.avatar || null} alt={contact.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  (contact.name || "User").slice(0, 2).toUpperCase()
                )}
              </div>
              <h2 className="font-bold text-base leading-tight flex items-center gap-1 justify-center">
                {contact.name}
                {contact.verified && <span className="text-[#53bdeb] text-sm">✔️</span>}
              </h2>
              <p className="text-xs opacity-60 mt-1">
                {contact.isGroup ? "WhatsApp Group Chat" : contact.phoneNumber || "No Phone Number"}
              </p>
            </div>

            {/* 2. Group Description / Contact About */}
            <div className="space-y-1">
              <h4 className="text-[10px] font-bold uppercase opacity-55 tracking-wider">
                {contact.isGroup ? "Group Description" : "About & Phone Status"}
              </h4>
              {contact.isGroup ? (
                <div className="space-y-2">
                  <textarea
                    value={contact.groupDescription || ""}
                    onChange={(e) => onUpdateContactSettings(contact.id, { groupDescription: e.target.value })}
                    placeholder="Enter group description or announcement..."
                    rows={3}
                    className={`w-full p-2 text-xs rounded border outline-none focus:ring-1 focus:ring-[#00a884] ${
                      isDark ? "bg-[#2a3942] border-gray-700" : "bg-gray-50 border-gray-200"
                    }`}
                  />
                </div>
              ) : (
                <p className="text-xs italic p-2 rounded bg-black/5 dark:bg-white/5">
                  {contact.about || "No status set."}
                </p>
              )}
            </div>

            {/* 3. Visual Media Gallery Preview (Shared images, videos, documents) */}
            <div className="space-y-2 pt-3 border-t border-black/5 dark:border-white/5">
              <h4 className="text-[10px] font-extrabold uppercase opacity-60 tracking-wider flex justify-between items-center text-[#00a884] dark:text-[#00e676]">
                <span>Shared Media & Docs</span>
                <span className="text-[9px] lowercase font-normal opacity-70">
                  {messages.filter((m) => ["image", "video", "file"].includes(m.type)).length} files
                </span>
              </h4>
              
              {messages.filter((m) => ["image", "video", "file"].includes(m.type)).length === 0 ? (
                <p className="text-[10px] opacity-50 italic px-1">No media files shared in this conversation yet.</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {messages
                    .filter((m) => ["image", "video", "file"].includes(m.type))
                    .slice(0, 8)
                    .map((m) => {
                      if (m.type === "image") {
                        return (
                          <div
                            key={m.id}
                            onClick={() => setActiveZoomImage(m.fileUrl || m.text)}
                            className="aspect-square rounded-lg bg-black/10 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity border border-black/5 dark:border-white/5 relative group shrink-0"
                            title="View image"
                          >
                            <img src={m.fileUrl || m.text} alt="preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        );
                      } else if (m.type === "video") {
                        return (
                          <div
                            key={m.id}
                            className="aspect-square rounded-lg bg-black flex items-center justify-center text-white cursor-pointer relative overflow-hidden border border-black/5 dark:border-white/5 shrink-0"
                            onClick={() => setActiveZoomImage(m.fileUrl || m.text)}
                            title="Play video"
                          >
                            <Video size={14} className="text-[#00a884] dark:text-[#00e676]" />
                            <div className="absolute inset-0 bg-black/10 hover:bg-black/0 transition-colors" />
                          </div>
                        );
                      } else {
                        return (
                          <div
                            key={m.id}
                            className="aspect-square rounded-lg bg-black/5 dark:bg-white/5 flex flex-col items-center justify-center p-1 text-center border border-black/5 dark:border-white/5 shrink-0 relative cursor-pointer hover:bg-black/10"
                            title={m.fileName || "document"}
                            onClick={() => {
                              if (m.fileUrl) {
                                window.open(m.fileUrl, "_blank");
                              }
                            }}
                          >
                            <FileText size={14} className="text-emerald-500" />
                            <span className="text-[7px] truncate w-full mt-1 opacity-80 font-mono leading-none">{m.fileName || "doc"}</span>
                          </div>
                        );
                      }
                    })}
                </div>
              )}
            </div>

            {/* 3. Group Administration settings & Participant control */}
            {contact.isGroup && (
              <div className="space-y-3.5 pt-2 border-t border-black/5 dark:border-white/5">
                <div className="flex justify-between items-center">
                  <h4 className="text-[10px] font-bold uppercase opacity-55 tracking-wider">
                    Participants ({contact.participants?.length || 0})
                  </h4>
                  {contact.inviteLink && (
                    <button
                      onClick={handleCopyInviteLink}
                      className="text-[#00a884] hover:underline text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Copy size={10} /> Copy Link
                    </button>
                  )}
                </div>

                {/* Add participant input form */}
                <form onSubmit={handleAddMember} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Simulate new user..."
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    className={`flex-1 px-2.5 py-1.5 text-xs rounded border outline-none focus:ring-1 focus:ring-[#00a884] ${
                      isDark ? "bg-[#2a3942] border-gray-700" : "bg-gray-50 border-gray-200"
                    }`}
                  />
                  <button
                    type="submit"
                    className="p-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded shrink-0 cursor-pointer"
                    title="Add Member"
                  >
                    <UserPlus size={14} />
                  </button>
                </form>

                {/* Participant list */}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {(contact.participants || []).map((participant) => {
                    const isAdmin = participant.role === "admin";
                    return (
                      <div
                        key={participant.id}
                        className="flex items-center justify-between p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-bold text-[10px]">
                            {participant.name.slice(0, 1).toUpperCase()}
                          </div>
                          <span className="font-bold truncate">{participant.name}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isAdmin ? (
                            <span className="text-[8px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded-full font-extrabold uppercase">
                              Admin
                            </span>
                          ) : (
                            <span className="text-[8px] opacity-40 uppercase">Member</span>
                          )}

                          {/* Controls (Disabled for self to prevent self-kicking) */}
                          {participant.id !== "me" && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleToggleAdmin(participant.id, participant.role)}
                                className={`p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 ${
                                  isAdmin ? "text-orange-400" : "text-emerald-500"
                                }`}
                                title={isAdmin ? "Demote from Admin" : "Promote to Admin"}
                              >
                                {isAdmin ? <ShieldAlert size={10} /> : <ShieldCheck size={10} />}
                              </button>
                              <button
                                onClick={() => handleKickMember(participant.id)}
                                className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-red-500"
                                title="Kick participant"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Group policies settings */}
                <div className="space-y-2 pt-2 border-t border-black/5 dark:border-white/5">
                  <h4 className="text-[10px] font-bold uppercase opacity-55 tracking-wider">
                    Group Policy Settings
                  </h4>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={contact.onlyAdminsCanSend || false}
                      onChange={(e) => onUpdateContactSettings(contact.id, { onlyAdminsCanSend: e.target.checked })}
                      className="accent-[#00a884] rounded"
                    />
                    <span>Only Admins Can Send Messages</span>
                  </label>
                </div>
              </div>
            )}

            {/* 4. Chat/Contact general actions */}
            <div className="space-y-3 pt-3 border-t border-black/5 dark:border-white/5 text-xs">
              <h4 className="text-[10px] font-bold uppercase opacity-55 tracking-wider">
                Privacy & Action Center
              </h4>

              <div className="flex justify-between items-center p-1 rounded">
                <span className="font-semibold">Mute Chat Notifications</span>
                <input
                  type="checkbox"
                  checked={contact.isMuted || false}
                  onChange={(e) => onUpdateContactSettings(contact.id, { isMuted: e.target.checked })}
                  className="accent-[#00a884] w-4 h-4"
                />
              </div>

              {!contact.isGroup && (
                <div className="flex justify-between items-center p-1 rounded">
                  <span className="font-semibold text-red-500">Block Contact</span>
                  <input
                    type="checkbox"
                    checked={contact.isBlocked || false}
                    onChange={(e) => onUpdateContactSettings(contact.id, { isBlocked: e.target.checked })}
                    className="accent-red-500 w-4 h-4"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Zoom Image Modal */}
      {activeZoomImage && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-xs z-50 flex flex-col items-center justify-center p-4">
          <div className="absolute top-4 right-4 flex gap-4 z-50">
            <a
              href={activeZoomImage}
              download="whatsapp_image.png"
              className="bg-white/10 hover:bg-white/20 text-white p-2.5 rounded-full shadow transition-all cursor-pointer"
            >
              <Download size={20} />
            </a>
            <button
              onClick={() => setActiveZoomImage(null)}
              className="bg-white/10 hover:bg-white/20 text-white p-2.5 rounded-full shadow transition-all cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
          <img
            src={activeZoomImage || null}
            alt="Zoom Detail"
            className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl"
            style={{ animation: "scaleUp 0.15s ease-out" }}
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
};
