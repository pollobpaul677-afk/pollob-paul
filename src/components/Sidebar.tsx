import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  Search,
  MoreVertical,
  Archive,
  Check,
  CheckCheck,
  PhoneMissed,
  Image as ImageIcon,
  Smile,
  Globe,
  Mic,
  FileText,
  User,
  Users,
  Phone,
  Laptop,
  PlusCircle,
  Sun,
  Moon,
  X,
  VolumeX,
  Compass,
  Sparkles,
  MessageSquarePlus,
  MessageSquare,
  Settings,
  Tv,
  Plus,
  RefreshCw,
  Video,
  ArrowLeft,
  LayoutGrid,
  Pin,
  PinOff,
  Volume2,
  Trash2,
  Ban,
  Heart,
  FolderUp,
  ChevronDown,
  Mail,
  BellOff,
  ListPlus,
  MinusCircle,
  ChevronRight,
  QrCode,
  Copy
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Contact, Message, UserProfile } from "../types";

interface SidebarProps {
  contacts: Contact[];
  lastMessages: Record<string, Message | undefined>;
  activeContactId: string | null;
  onSelectContact: (id: string) => void;
  onArchiveContact?: (id: string, archiveState: boolean) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  userProfile: UserProfile;
  onJoinGroupByInvite: (groupName: string, inviteUrl: string) => void;
  onViewProfile?: (id: string) => void;

  // Sync state passed down from parent
  whatsappStatus: "disconnected" | "connecting" | "qr-ready" | "pairing-code-ready" | "connected";
  qrCodeData: string | null;
  pairingCode: string;
  connectedUser: { name: string; phoneNumber: string; id: string } | null;
  whatsappError: string | null;
  onStartPairing: (phone?: string) => void;
  onDisconnectWhatsapp: () => void;
  onAddNewContact?: (name: string, phone: string) => void;
  onUpdateContactSettings?: (contactId: string, updates: Partial<Contact>) => void;
  onClearChat?: (contactId: string) => void;
  onDeleteChat?: (contactId: string) => void;
  isSocketConnected?: boolean;
  activeServerUrl?: string;
  onUpdateServerUrl?: (url: string) => void;
}

type BottomTab = "chats" | "updates" | "communities" | "calls" | "you";

export const Sidebar: React.FC<SidebarProps> = ({
  contacts,
  lastMessages,
  activeContactId,
  onSelectContact,
  onArchiveContact,
  isDark,
  onToggleTheme,
  onOpenProfile,
  userProfile,
  onJoinGroupByInvite,
  whatsappStatus,
  qrCodeData,
  pairingCode,
  connectedUser,
  whatsappError,
  onStartPairing,
  onDisconnectWhatsapp,
  onAddNewContact,
  onUpdateContactSettings,
  onClearChat,
  onDeleteChat,
  onViewProfile,
  isSocketConnected = true,
  activeServerUrl,
  onUpdateServerUrl,
}) => {
  const [activeTab, setActiveTab] = useState<BottomTab>("chats");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showMultiDeviceModal, setShowMultiDeviceModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [customServerInput, setCustomServerInput] = useState(activeServerUrl || "");

  useEffect(() => {
    if (activeServerUrl) {
      setCustomServerInput(activeServerUrl);
    }
  }, [activeServerUrl]);

  // New Chat Panel & Keypad States
  const [showNewChatDrawer, setShowNewChatDrawer] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dialNumber, setDialNumber] = useState("");
  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Floating WhatsApp Long-Press / Right-Click Context Menu State
  const [contextMenuTarget, setContextMenuTarget] = useState<{
    contact: Contact;
    position: { x: number; y: number };
  } | null>(null);
  const [activeSubMenu, setActiveSubMenu] = useState<"mute" | "list" | null>(null);

  // Long press refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressActiveRef = useRef(false);

  const startLongPress = (contact: Contact, clientX: number, clientY: number) => {
    isLongPressActiveRef.current = false;
    touchStartPosRef.current = { x: clientX, y: clientY };

    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(40); } catch (_) {}
      }
      setContextMenuTarget({
        contact,
        position: { x: clientX, y: clientY },
      });
      setActiveSubMenu(null);
    }, 450);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const computeContextMenuPosition = (pos: { x: number; y: number }) => {
    if (typeof window === "undefined") return {};
    const width = 250;
    const height = 430;
    let left = pos.x;
    let top = pos.y;

    if (left + width > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - width - 16);
    }
    if (top + height > window.innerHeight - 16) {
      top = Math.max(16, window.innerHeight - height - 16);
    }

    return {
      left: `${Math.max(16, left)}px`,
      top: `${Math.max(16, top)}px`,
    };
  };

  // Phone linking internal inputs
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [pairingMode, setPairingMode] = useState<"qr" | "phone">("qr");
  const [copiedPairingCode, setCopiedPairingCode] = useState(false);

  useEffect(() => {
    if (!showMultiDeviceModal) {
      if (whatsappStatus === "disconnected") {
        setShowPhoneInput(false);
        setPairingMode("qr");
      }
    }
  }, [showMultiDeviceModal, whatsappStatus]);

  const getAlphabeticalGroups = () => {
    const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name));
    const groups: Record<string, Contact[]> = {};
    sorted.forEach((c) => {
      if (c.isGroup) return; // Only list individual contacts in alphabetical directory
      const firstLetter = c.name.slice(0, 1).toUpperCase();
      const key = /[A-Z]/.test(firstLetter) ? firstLetter : "#";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return groups;
  };

  const handleCreateNewGroupLocal = () => {
    if (!newGroupName.trim()) return;
    if (onAddNewContact) {
      onAddNewContact(newGroupName.trim(), `GROUP_CREATION_MARKER_${Date.now()}`);
      setNewGroupName("");
      setShowNewGroupModal(false);
      setShowNewChatDrawer(false);
    }
  };

  const handleStartPairing = (phone?: string) => {
    onStartPairing(phone);
  };

  const handleDisconnectWhatsapp = () => {
    onDisconnectWhatsapp();
    setShowPhoneInput(false);
  };

  // Invite form inputs
  const [inviteGroupName, setInviteGroupName] = useState("");
  const [inviteLink, setInviteLink] = useState("");

  const renderLastMessageStatus = (msg: Message) => {
    if (msg.sender !== "me") return null;

    if (msg.status === "sent") {
      return <Check size={14} className="text-[#8696a0] shrink-0" />;
    } else if (msg.status === "delivered") {
      return <CheckCheck size={14} className="text-[#8696a0] shrink-0" />;
    } else if (msg.status === "read") {
      return <CheckCheck size={14} className="text-[#53bdeb] shrink-0" />;
    }
    return null;
  };

  const renderLastMessageText = (contact: Contact, msg?: Message) => {
    if (!msg) return <span className="opacity-60 text-xs italic">No messages yet</span>;

    // Check if call or missed call
    if (
      msg.type === "call" ||
      msg.text?.toLowerCase().includes("missed voice call") ||
      msg.text?.toLowerCase().includes("missed video call") ||
      Boolean(msg.callData)
    ) {
      const isMissed = msg.callData?.status === "missed" || msg.text?.toLowerCase().includes("missed");
      const isVideo = msg.callData?.callType === "video" || msg.text?.toLowerCase().includes("video");
      return (
        <span className={`flex items-center gap-1.5 text-xs font-medium ${isMissed ? "text-red-500" : "opacity-85 text-inherit"}`}>
          {isMissed ? (
            <PhoneMissed size={12} className="text-red-500 shrink-0" />
          ) : isVideo ? (
            <Video size={12} className="shrink-0 text-emerald-500" />
          ) : (
            <Phone size={12} className="shrink-0 text-emerald-500" />
          )}
          {isMissed
            ? `Missed ${isVideo ? "video" : "voice"} call`
            : `${isVideo ? "Video" : "Voice"} call${msg.callData?.duration ? ` (${msg.callData.duration})` : ""}`}
        </span>
      );
    }

    const isMe = msg.sender === "me";
    const prefix = isMe ? "" : ""; // Keep clean without prefix matching official WhatsApp Web style

    if (msg.type === "image") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          <ImageIcon size={12} className="shrink-0" /> {msg.text && msg.text !== "Photo" ? msg.text : "Photo"}
        </span>
      );
    }
    if (msg.type === "video") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          <Tv size={12} className="shrink-0" /> {msg.text && msg.text !== "Video" ? msg.text : "Video"}
        </span>
      );
    }
    if (msg.type === "sticker") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          <Smile size={12} className="shrink-0" /> Sticker
        </span>
      );
    }
    if (msg.type === "location") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          <Globe size={12} className="shrink-0" /> Shared location
        </span>
      );
    }
    if (msg.type === "poll") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          📊 Poll: {msg.pollData?.question}
        </span>
      );
    }
    if (msg.type === "contact") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          <User size={12} className="shrink-0" /> Shared contact
        </span>
      );
    }
    if (msg.type === "voice") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          <Mic size={12} className="shrink-0 text-[#00a884] dark:text-[#00e676]" /> Voice message {msg.voiceDuration ? `(${msg.voiceDuration})` : ""}
        </span>
      );
    }
    if (msg.type === "file") {
      return (
        <span className="flex items-center gap-1 opacity-85 text-xs text-inherit">
          <FileText size={12} className="shrink-0" /> {msg.fileName || "Document"} {msg.fileSize ? `(${msg.fileSize})` : ""}
        </span>
      );
    }

    return <span className="truncate block max-w-[220px]">{prefix}{msg.text}</span>;
  };

  const handleCreateInviteGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteGroupName.trim() || !inviteLink.trim()) {
      alert("Please fill in both fields.");
      return;
    }
    onJoinGroupByInvite(inviteGroupName.trim(), inviteLink.trim());
    setInviteGroupName("");
    setInviteLink("");
    setShowInviteModal(false);
  };

  const [showArchivedOnly, setShowArchivedOnly] = useState(false);

  // Filter Contacts
  const filteredContacts = contacts
    .filter((c) => {
      if (showArchivedOnly) {
        if (!c.archive) return false;
      } else {
        if (c.archive) return false;
      }
      return c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
             c.about.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      const aPinned = a.isPinned ? 1 : 0;
      const bPinned = b.isPinned ? 1 : 0;
      return bPinned - aPinned;
    });

  return (
    <div className={`flex h-full shrink-0 border-r ${activeContactId ? "hidden md:flex" : "flex"} w-full md:w-[440px] lg:w-[480px]`}>
      {/* 1. Thin Left Navigation Panel for Desktop (Strict Parity with screenshots) */}
      <div className={`hidden md:flex flex-col items-center justify-between w-16 h-full py-4 shrink-0 border-r ${
        isDark ? "bg-[#202c33] border-gray-800 text-[#aebac1]" : "bg-[#f0f2f5] border-gray-200 text-[#54656f]"
      }`}>
        {/* Top Icons group */}
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Chats tab */}
          <button
            onClick={() => {
              setActiveTab("chats");
              setShowArchivedOnly(false);
            }}
            className={`p-2.5 rounded-xl transition-all relative cursor-pointer ${
              activeTab === "chats" && !showArchivedOnly
                ? isDark ? "bg-[#102d26] text-[#00e676]" : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/10 text-inherit"
            }`}
            title="Chats"
          >
            <MessageSquare size={20} />
            <div className="absolute -top-1 -right-1 bg-[#00e676] text-[#0b141a] font-extrabold text-[9px] w-[16px] h-[16px] rounded-full flex items-center justify-center border border-white dark:border-[#0b141a]">
              3
            </div>
          </button>
          
          {/* Updates tab */}
          <button
            onClick={() => {
              setActiveTab("updates");
              setShowArchivedOnly(false);
            }}
            className={`p-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === "updates"
                ? isDark ? "bg-[#102d26] text-[#00e676]" : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/10 text-inherit"
            }`}
            title="Updates"
          >
            <Compass size={20} />
          </button>

          {/* Communities tab */}
          <button
            onClick={() => {
              setActiveTab("communities");
              setShowArchivedOnly(false);
            }}
            className={`p-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === "communities"
                ? isDark ? "bg-[#102d26] text-[#00e676]" : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/10 text-inherit"
            }`}
            title="Communities"
          >
            <Users size={20} />
          </button>

          {/* Calls tab */}
          <button
            onClick={() => {
              setActiveTab("calls");
              setShowArchivedOnly(false);
            }}
            className={`p-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === "calls"
                ? isDark ? "bg-[#102d26] text-[#00e676]" : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/10 text-inherit"
            }`}
            title="Calls"
          >
            <Phone size={20} />
          </button>

          {/* Archived tab shortcut */}
          <button
            onClick={() => {
              setActiveTab("chats");
              setShowArchivedOnly(true);
            }}
            className={`p-2.5 rounded-xl transition-all cursor-pointer ${
              showArchivedOnly
                ? isDark ? "bg-[#102d26] text-[#00e676]" : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/10 text-inherit"
            }`}
            title="Archived chats"
          >
            <Archive size={20} />
          </button>
        </div>

        {/* Bottom Icons group */}
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Light/Dark Mode toggle */}
          <button
            onClick={onToggleTheme}
            className="p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-inherit cursor-pointer"
            title="Toggle Theme"
          >
            {isDark ? <Sun size={20} className="text-yellow-400" /> : <Moon size={20} />}
          </button>

          {/* Settings / Multi-device */}
          <button
            onClick={() => setShowMultiDeviceModal(true)}
            className="p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-inherit cursor-pointer"
            title="Linked Devices"
          >
            <Laptop size={20} />
          </button>

          {/* Profile picture button */}
          <button
            onClick={onOpenProfile}
            className="w-8 h-8 rounded-full overflow-hidden border border-black/15 dark:border-white/15 transition-transform active:scale-95 cursor-pointer"
            title="My Profile"
          >
            <img src={userProfile.avatar} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </button>
        </div>
      </div>

      {/* 2. Main List Content Area (chats, updates, communities, etc.) */}
      <div className={`flex-1 h-full flex flex-col relative overflow-hidden ${
        isDark ? "bg-[#0b141a] text-[#e9edef]" : "bg-white text-[#111b21]"
      }`}>
        {/* 1. CHATS TAB CONTENT */}
        {activeTab === "chats" && (
          <div className="flex-1 flex flex-col min-h-0 relative">
            {/* Top Brand Header */}
            {showArchivedOnly ? (
              <div className="flex items-center gap-4 px-5 pt-5 pb-2.5 shrink-0 border-b border-black/5 dark:border-white/5 w-full">
                <button
                  onClick={() => setShowArchivedOnly(false)}
                  className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-[#00a884] shrink-0"
                  title="Go back to Chats"
                >
                  <X size={20} />
                </button>
                <span className="font-bold text-xl tracking-tight select-none flex-1 text-[#111b21] dark:text-[#e9edef]">Archived Chats</span>
              </div>
            ) : (
              <div className="flex items-center justify-between px-5 pt-5 pb-2.5 shrink-0">
                <span className="text-[#00a884] font-bold text-2xl tracking-tight select-none">WhatsApp</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowNewChatDrawer(true)}
                    className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-[#54656f] dark:text-[#aebac1]"
                    title="New Chat"
                    id="new-chat-btn"
                  >
                    <MessageSquarePlus size={20} />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-[#54656f] dark:text-[#aebac1]"
                      id="three-dots-menu-btn"
                    >
                      <MoreVertical size={20} />
                    </button>

                {/* Three-Dot Dropdown Menu */}
                {showDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowDropdown(false)}
                    />
                    <div
                      className={`absolute right-0 mt-2 w-52 rounded-xl shadow-xl border z-50 py-1 text-sm ${
                        isDark ? "bg-[#222e35] border-gray-700 text-white" : "bg-white border-gray-200 text-gray-800"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          onOpenProfile();
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                      >
                        <User size={16} /> My Profile
                      </button>
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          onToggleTheme();
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                      >
                        {isDark ? <Sun size={16} className="text-yellow-400" /> : <Moon size={16} />}
                        {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                      </button>
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          setShowMultiDeviceModal(true);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                      >
                        <Laptop size={16} /> Linked Devices
                      </button>
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          setShowInviteModal(true);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                      >
                        <PlusCircle size={16} /> Join Group via Link
                      </button>
                      <div className="border-t border-black/5 dark:border-white/5 my-1" />
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          if (confirm("Reset chat list to match the image exactly?")) {
                            localStorage.removeItem("wa_contacts");
                            localStorage.removeItem("wa_chats");
                            window.location.reload();
                          }
                        }}
                        className="w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-500/10 flex items-center gap-2.5 cursor-pointer font-bold"
                      >
                        🔄 Reset App State
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

          {/* Search bar with exact text: "Ask Meta AI or Search" */}
          <div className="px-4 pb-2.5 shrink-0">
            <div className="flex items-center gap-3.5 px-4 py-2.5 rounded-full text-sm bg-[#f0f2f5] dark:bg-[#202c33] border-none">
              <Search size={18} className="text-gray-400 dark:text-gray-500 shrink-0" />
              <input
                type="text"
                placeholder="Ask Meta AI or Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none w-full text-inherit placeholder-gray-500 dark:placeholder-gray-400 text-sm"
              />
            </div>
          </div>

          {/* 3-Month Active Sync Indicator Notice */}
          {whatsappStatus === "connected" && (
            <div className="px-4 pb-2 shrink-0">
              <div className="flex items-center justify-between px-3 py-1.5 rounded-lg text-[11px] bg-[#00a884]/10 dark:bg-[#00a884]/15 border border-[#00a884]/25 text-[#00a884] dark:text-[#00e676]">
                <span className="flex items-center gap-1.5 font-medium truncate">
                  <span>🕒</span>
                  <span className="truncate">গত ৩ মাসের চ্যাট সিঙ্ক হয়েছে (Last 3 months)</span>
                </span>
                <span className="text-[10px] font-bold opacity-80 shrink-0 ml-2">
                  {filteredContacts.length} Chats
                </span>
              </div>
            </div>
          )}

          {/* Archived Row */}
          {!showArchivedOnly && contacts.some((c) => c.archive) && (
            <div className="border-b border-black/5 dark:border-white/5 shrink-0">
              <button
                onClick={() => setShowArchivedOnly(true)}
                className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer text-left"
              >
                <Archive size={20} className="text-[#00a884] dark:text-[#00e676] shrink-0" />
                <span className="font-semibold text-[15px] text-[#111b21] dark:text-[#e9edef] flex-1">Archived</span>
                <span className="bg-[#00a884] dark:bg-[#00e676] text-white dark:text-[#0b141a] text-xs font-bold px-2 py-0.5 rounded-full">
                  {contacts.filter((c) => c.archive).length}
                </span>
              </button>
            </div>
          )}

          {/* Chat rows list */}
          <div className="flex-1 overflow-y-auto divide-y divide-black/[0.03] dark:divide-white/[0.03] pb-24">
            {filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-xs opacity-50">No chats found.</div>
            ) : (
              filteredContacts.map((contact) => {
                const lastMsg = lastMessages[contact.id];
                const isActive = activeContactId === contact.id;
                const hasUnread = contact.unreadCount > 0 && !isActive;

                return (
                  <div
                    key={contact.id}
                    onClick={() => {
                      if (isLongPressActiveRef.current) {
                        isLongPressActiveRef.current = false;
                        return;
                      }
                      onSelectContact(contact.id);
                    }}
                    onMouseDown={(e) => {
                      if (e.button === 0) {
                        startLongPress(contact, e.clientX, e.clientY);
                      }
                    }}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={cancelLongPress}
                    onTouchStart={(e) => {
                      if (e.touches && e.touches[0]) {
                        startLongPress(contact, e.touches[0].clientX, e.touches[0].clientY);
                      }
                    }}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={(e) => {
                      if (touchStartPosRef.current && e.touches && e.touches[0]) {
                        const dist = Math.hypot(
                          e.touches[0].clientX - touchStartPosRef.current.x,
                          e.touches[0].clientY - touchStartPosRef.current.y
                        );
                        if (dist > 10) cancelLongPress();
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelLongPress();
                      setContextMenuTarget({
                        contact,
                        position: { x: e.clientX, y: e.clientY },
                      });
                      setActiveSubMenu(null);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onSelectContact(contact.id);
                      }
                    }}
                    className={`w-full text-left flex items-center gap-3.5 px-4 py-3.5 transition-colors select-none cursor-pointer border-l-4 group relative ${
                      isActive
                        ? "bg-black/[0.04] dark:bg-white/[0.04] border-[#00a884]"
                        : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02] border-transparent"
                    }`}
                  >
                    {/* Profile Avatar circle */}
                    <div
                      className="relative shrink-0 cursor-pointer hover:scale-105 transition-transform duration-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onViewProfile) {
                          onViewProfile(contact.id);
                        } else {
                          onSelectContact(contact.id);
                        }
                      }}
                      title={`View ${contact.name}'s Profile Info`}
                    >
                      {contact.avatar === "letter-S" ? (
                        <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center bg-[#eae6f9] dark:bg-[#2e2b44] text-[#6b42f5] dark:text-[#a28dfa] text-xl font-bold select-none">
                          S
                        </div>
                      ) : contact.avatar === "black-circle" ? (
                        <div className="w-12 h-12 rounded-full bg-black border border-gray-800" />
                      ) : contact.avatar ? (
                        <div className="w-12 h-12 rounded-full overflow-hidden border border-black/5 dark:border-white/5 bg-gray-100 dark:bg-gray-800 relative flex items-center justify-center">
                          <img
                            src={contact.avatar || null}
                            alt={contact.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = "none";
                            }}
                          />
                          <span className="text-gray-500 font-bold text-base absolute inset-0 flex items-center justify-center -z-10">
                            {(contact.name && isNaN(Number(contact.name)) ? contact.name : "U").slice(0, 1).toUpperCase()}
                          </span>
                        </div>
                      ) : contact.isGroup ? (
                        <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 font-bold">
                          <Users size={22} />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center bg-gray-200 dark:bg-gray-800 text-gray-500 font-bold">
                          {contact.name?.startsWith("+") || contact.phoneNumber ? (
                            <User size={22} className="text-gray-400 dark:text-gray-500" />
                          ) : (
                            (contact.name && isNaN(Number(contact.name)) ? contact.name : "User").slice(0, 1).toUpperCase()
                          )}
                        </div>
                      )}

                      {/* Online dot indicator */}
                      {contact.status === "online" && (
                        <div className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-[#00e676] rounded-full border-2 border-white dark:border-[#0b141a]" />
                      )}
                    </div>

                    {/* Chat Text Details Column */}
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      {/* Name & Time Row */}
                      <div className="flex justify-between items-baseline">
                        <span className="font-semibold text-[15px] truncate text-[#111b21] dark:text-[#e9edef] flex items-center gap-1.5">
                          {contact.name && isNaN(Number(contact.name)) ? contact.name : (contact.phoneNumber || "WhatsApp User")}
                          {contact.isPinned && <Pin size={12} className="text-orange-500 fill-orange-500/20 rotate-45 shrink-0" />}
                          {contact.isMuted && <VolumeX size={12} className="text-gray-400 shrink-0" />}
                          {contact.isBlocked && <span className="bg-red-500/10 text-red-500 text-[8px] px-1 rounded font-extrabold shrink-0">BLOCKED</span>}
                          {contact.isFavorite && <Heart size={10} className="fill-red-500 text-red-500 shrink-0" />}
                        </span>
                        <span
                          className={`text-[11px] font-medium shrink-0 ${
                            hasUnread ? "text-[#00a884]" : "text-gray-400 dark:text-gray-500"
                          }`}
                        >
                          {lastMsg ? lastMsg.timestamp : ""}
                        </span>
                      </div>

                      {/* Msg text & Unread badge row */}
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-1.5 text-xs text-[#667781] dark:text-[#8696a0] truncate flex-1 pr-2">
                          {lastMsg && renderLastMessageStatus(lastMsg)}
                          {renderLastMessageText(contact, lastMsg)}
                        </div>

                        <div className="flex items-center gap-1.5 relative">
                          {/* Hover Archive/Unarchive Action */}
                          {onArchiveContact && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onArchiveContact(contact.id, !contact.archive);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-[#00a884] dark:text-gray-400 dark:hover:text-[#00e676] hover:scale-110 transition-all cursor-pointer shrink-0"
                              title={contact.archive ? "Unarchive chat" : "Archive chat"}
                            >
                              <Archive size={14} />
                            </button>
                          )}

                          {/* Chevron Menu Trigger for WhatsApp Context Menu */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setContextMenuTarget({
                                contact,
                                position: { x: rect.right - 240, y: rect.bottom + 5 },
                              });
                              setActiveSubMenu(null);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-[#00a884] dark:text-gray-400 dark:hover:text-[#00e676] transition-all cursor-pointer shrink-0"
                            title="Chat options"
                          >
                            <ChevronDown size={14} />
                          </button>

                          {/* Unread circle badge */}
                          {hasUnread && (
                            <div className="bg-[#00a884] text-white font-bold text-[11px] h-5 w-5 flex items-center justify-center rounded-full shrink-0 animate-scale-up">
                              {contact.unreadCount}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* FLOATING ACTION BUTTONS overlay inside list area */}
          <div className="absolute bottom-20 right-4 flex flex-col gap-3.5 items-end z-30">
            {/* 1. Meta AI sparkle button */}
            <button
              onClick={() => {
                onSelectContact("contact-1");
                alert("Ask anything! You are now chatting with our AI-powered assistant.");
              }}
              className="p-3.5 bg-white dark:bg-[#202c33] text-purple-600 dark:text-purple-400 rounded-full shadow-lg border border-black/5 dark:border-white/5 hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
              title="Ask Meta AI"
            >
              <Sparkles size={20} fill="currentColor" className="opacity-90" />
            </button>

            {/* 2. New message squircle button with unread count 2 on top of it */}
            <div className="relative">
              <button
                onClick={() => setShowInviteModal(true)}
                className="p-4 bg-[#00a884] hover:bg-[#008069] text-white rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                title="New Chat / Group"
              >
                <MessageSquarePlus size={24} />
              </button>
              {/* Unread dot count "2" badge overlay */}
              <div className="absolute -top-1.5 -right-1.5 bg-[#005c4b] dark:bg-[#00e676] text-white dark:text-[#0b141a] font-extrabold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow-md">
                2
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. UPDATES TAB CONTENT */}
      {activeTab === "updates" && (
        <div className="flex-1 flex flex-col min-h-0 p-5 overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-[#111b21] dark:text-[#e9edef]">Updates</h2>
            <button
              onClick={() => alert("Recent channel settings")}
              className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full"
            >
              <MoreVertical size={20} />
            </button>
          </div>

          {/* Status Section */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wider text-[11px]">Status</h3>
            <div className="flex items-center gap-4.5">
              <div className="relative cursor-pointer">
                <img
                  src={userProfile.avatar || null}
                  alt="My Status"
                  className="w-12 h-12 rounded-full object-cover border-2 border-gray-300 dark:border-gray-700 p-0.5"
                />
                <div className="absolute bottom-0 right-0 bg-[#00a884] text-white p-0.5 rounded-full border border-white dark:border-[#0b141a]">
                  <Plus size={12} />
                </div>
              </div>
              <div>
                <h4 className="font-bold text-sm">My Status</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">Tap to add status update</p>
              </div>
            </div>
          </div>

          <div className="border-t border-black/5 dark:border-white/5 my-4" />

          {/* Recent Channel Updates simulated */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[11px]">Channels</h3>
              <button
                onClick={() => alert("Channel Explorer initiated")}
                className="text-[#00a884] text-xs font-bold hover:underline"
              >
                Explore
              </button>
            </div>

            <div className="space-y-4">
              {[
                { name: "WhatsApp Announcements 📢", icon: "🟢", desc: "We've added incredible new themes!", time: "9:15 AM" },
                { name: "FC Barcelona", icon: "🔵🔴", desc: "Training highlights from this morning in Spain ⚽", time: "Yesterday" },
                { name: "Tech Gadgets Digest", icon: "🔋", desc: "Top 5 upcoming gadgets this holiday season", time: "2 days ago" },
              ].map((chan, i) => (
                <div key={i} className="flex gap-4 items-center cursor-pointer p-1.5 hover:bg-black/[0.01] rounded">
                  <div className="w-11 h-11 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center text-lg">
                    {chan.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                      <h4 className="font-bold text-xs truncate pr-2">{chan.name}</h4>
                      <span className="text-[10px] text-gray-400 shrink-0">{chan.time}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{chan.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3. COMMUNITIES TAB CONTENT */}
      {activeTab === "communities" && (
        <div className="flex-1 flex flex-col min-h-0 p-5 overflow-y-auto text-center justify-center items-center">
          <div className="max-w-xs space-y-4">
            <div className="w-20 h-20 bg-[#e1f3ec] dark:bg-[#122e23] rounded-3xl flex items-center justify-center mx-auto text-[#00a884]">
              <Users size={44} />
            </div>
            <h2 className="text-xl font-bold text-[#111b21] dark:text-[#e9edef]">Introducing Communities</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Easily organize your related groups and send announcements. Now, your school, neighborhood, or workspace groups can have their own space.
            </p>
            <button
              onClick={() => alert("Community Creator initiated")}
              className="px-5 py-2.5 bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold rounded-full transition-colors cursor-pointer shadow"
            >
              Start Your Community
            </button>
          </div>
        </div>
      )}

      {/* 4. CALLS TAB CONTENT */}
      {activeTab === "calls" && (
        <div className="flex-1 flex flex-col min-h-0 p-5 overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-[#111b21] dark:text-[#e9edef]">Calls</h2>
            <button
              onClick={() => alert("Calls log settings")}
              className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full"
            >
              <MoreVertical size={20} />
            </button>
          </div>

          <div className="space-y-4">
            {/* Create Call Link */}
            <div className="flex items-center gap-4 cursor-pointer mb-5">
              <div className="w-11 h-11 rounded-full bg-[#e1f3ec] dark:bg-[#122e23] text-[#00a884] flex items-center justify-center">
                <PlusCircle size={22} />
              </div>
              <div>
                <h4 className="font-bold text-xs text-[#111b21] dark:text-[#e9edef]">Create call link</h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">Share a link for your WhatsApp call</p>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[11px] mb-2">Recent Call Logs</h3>

            {[
              { name: "Ma🥰🥰", time: "Yesterday, 3:15 PM", type: "missed_voice", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80" },
              { name: "Faruk Vai", time: "July 5, 8:12 PM", type: "outgoing_voice", avatar: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=150&auto=format&fit=crop&q=80" },
              { name: "Sabbir Choto Vai3", time: "July 3, 10:45 AM", type: "incoming_video", avatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80" },
            ].map((log, i) => (
              <div key={i} className="flex gap-4 items-center py-2 border-b border-black/[0.02] dark:border-white/[0.02]">
                <img
                  src={log.avatar || null}
                  alt={log.name}
                  className="w-11 h-11 rounded-full object-cover bg-gray-100 border border-black/5"
                  referrerPolicy="no-referrer"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-xs text-[#111b21] dark:text-[#e9edef]">{log.name}</h4>
                  <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                    {log.type === "missed_voice" ? (
                      <span className="text-red-500 flex items-center gap-1 font-medium"><PhoneMissed size={10} /> Missed voice call</span>
                    ) : log.type === "outgoing_voice" ? (
                      <span className="text-emerald-500 flex items-center gap-1 font-medium">↗ Outgoing call</span>
                    ) : (
                      <span className="text-blue-500 flex items-center gap-1 font-medium">↙ Incoming video call</span>
                    )}
                    • {log.time}
                  </p>
                </div>
                <button
                  onClick={() => alert(`Initiating call with ${log.name}...`)}
                  className="p-2 text-[#00a884] hover:bg-black/5 rounded-full"
                >
                  {log.type.includes("video") ? <Video size={16} /> : <Phone size={16} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. YOU / SETTINGS TAB CONTENT */}
      {activeTab === "you" && (
        <div className="flex-1 flex flex-col min-h-0 p-5 overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-[#111b21] dark:text-[#e9edef]">You</h2>
            <button
              onClick={() => alert("Settings configuration")}
              className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full"
            >
              <MoreVertical size={20} />
            </button>
          </div>

          {/* Large user profile card */}
          <div
            onClick={onOpenProfile}
            className="flex items-center gap-4.5 p-4 bg-black/5 dark:bg-white/5 rounded-2xl cursor-pointer hover:scale-[1.01] transition-transform"
          >
            <img
              src={userProfile.avatar || null}
              alt="Me"
              className="w-14 h-14 rounded-full object-cover border border-emerald-500/20"
              referrerPolicy="no-referrer"
            />
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm truncate">{userProfile.name}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{userProfile.about}</p>
              <p className="text-[10px] text-gray-400 font-mono mt-0.5">{userProfile.phoneNumber}</p>
            </div>
            <Settings size={18} className="text-gray-400" />
          </div>

          {/* Quick links settings list */}
          <div className="mt-6 space-y-1">
            <button
              onClick={onOpenProfile}
              className="w-full text-left px-4 py-3.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-xs flex items-center justify-between font-bold cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-3">👤 Profile Customization</span>
              <span className="text-gray-400 text-sm">→</span>
            </button>
            <button
              onClick={onToggleTheme}
              className="w-full text-left px-4 py-3.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-xs flex items-center justify-between font-bold cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-3">🌗 Change Application Theme</span>
              <span className="bg-emerald-500/10 text-emerald-500 text-[10px] uppercase px-2 py-0.5 rounded-full font-extrabold">
                {isDark ? "DARK" : "LIGHT"}
              </span>
            </button>
            <button
              onClick={() => setShowMultiDeviceModal(true)}
              className="w-full text-left px-4 py-3.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-xs flex items-center justify-between font-bold cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-3">💻 Paired Devices (Multi-Device)</span>
              <span className="bg-emerald-500/10 text-emerald-500 text-[10px] uppercase px-2 py-0.5 rounded-full font-extrabold">
                ACTIVE
              </span>
            </button>
            <button
              onClick={() => setShowInviteModal(true)}
              className="w-full text-left px-4 py-3.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-xs flex items-center justify-between font-bold cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-3">🔗 Group Join by Link Invite</span>
              <span className="text-gray-400 text-sm">→</span>
            </button>
          </div>
        </div>
      )}

      {/* BOTTOM MOBILE-STYLE NAVIGATION BAR */}
      <div
        className={`absolute bottom-0 inset-x-0 h-16 border-t flex items-center justify-around px-2 z-30 select-none ${
          isDark ? "bg-[#0b141a] border-gray-800 text-[#aebac1]" : "bg-white border-gray-200 text-[#54656f]"
        }`}
      >
        {/* Tab 1: Chats */}
        <button
          onClick={() => setActiveTab("chats")}
          className="flex flex-col items-center gap-1 py-1 cursor-pointer w-16 text-center select-none"
        >
          <div className="relative">
            <div
              className={`px-5 py-1 rounded-full transition-all duration-200 flex items-center justify-center ${
                activeTab === "chats"
                  ? isDark
                    ? "bg-[#102d26] text-[#00e676]"
                    : "bg-[#d9fdd3] text-[#0b141a]"
                  : "hover:bg-black/5 dark:hover:bg-white/5 text-inherit"
              }`}
            >
              <MessageSquare size={20} />
            </div>
            {/* Chats tab unread count badge overlay */}
            <div className="absolute -top-1.5 -right-1.5 bg-[#00e676] text-[#0b141a] font-extrabold text-[10px] w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-white dark:border-[#0b141a]">
              3
            </div>
          </div>
          <span className={`text-[10px] font-bold ${activeTab === "chats" ? "text-emerald-500 dark:text-[#00e676]" : "opacity-75"}`}>
            Chats
          </span>
        </button>

        {/* Tab 2: Updates */}
        <button
          onClick={() => setActiveTab("updates")}
          className="flex flex-col items-center gap-1 py-1 cursor-pointer w-16 text-center select-none"
        >
          <div
            className={`px-5 py-1 rounded-full transition-all duration-200 flex items-center justify-center ${
              activeTab === "updates"
                ? isDark
                  ? "bg-[#102d26] text-[#00e676]"
                  : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/5 text-inherit"
            }`}
          >
            <Compass size={20} />
          </div>
          <span className={`text-[10px] font-bold ${activeTab === "updates" ? "text-emerald-500 dark:text-[#00e676]" : "opacity-75"}`}>
            Updates
          </span>
        </button>

        {/* Tab 3: Communities */}
        <button
          onClick={() => setActiveTab("communities")}
          className="flex flex-col items-center gap-1 py-1 cursor-pointer w-20 text-center select-none"
        >
          <div
            className={`px-5 py-1 rounded-full transition-all duration-200 flex items-center justify-center ${
              activeTab === "communities"
                ? isDark
                  ? "bg-[#102d26] text-[#00e676]"
                  : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/5 text-inherit"
            }`}
          >
            <Users size={20} />
          </div>
          <span className={`text-[10px] font-bold ${activeTab === "communities" ? "text-emerald-500 dark:text-[#00e676]" : "opacity-75"}`}>
            Communities
          </span>
        </button>

        {/* Tab 4: Calls */}
        <button
          onClick={() => setActiveTab("calls")}
          className="flex flex-col items-center gap-1 py-1 cursor-pointer w-16 text-center select-none"
        >
          <div
            className={`px-5 py-1 rounded-full transition-all duration-200 flex items-center justify-center ${
              activeTab === "calls"
                ? isDark
                  ? "bg-[#102d26] text-[#00e676]"
                  : "bg-[#d9fdd3] text-[#0b141a]"
                : "hover:bg-black/5 dark:hover:bg-white/5 text-inherit"
            }`}
          >
            <Phone size={20} />
          </div>
          <span className={`text-[10px] font-bold ${activeTab === "calls" ? "text-emerald-500 dark:text-[#00e676]" : "opacity-75"}`}>
            Calls
          </span>
        </button>

        {/* Tab 5: You */}
        <button
          onClick={() => setActiveTab("you")}
          className="flex flex-col items-center gap-1 py-1 cursor-pointer w-16 text-center select-none"
        >
          <div
            className={`w-7 h-7 rounded-full overflow-hidden border-2 transition-all duration-200 flex items-center justify-center shrink-0 ${
              activeTab === "you" ? "border-emerald-500 scale-105" : "border-transparent opacity-85"
            }`}
          >
            <img src={userProfile.avatar || null} alt="You" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <span className={`text-[10px] font-bold ${activeTab === "you" ? "text-emerald-500 dark:text-[#00e676]" : "opacity-75"}`}>
            You
          </span>
        </button>
      </div>

      {/* DIALOG MODAL 1: JOIN GROUP BY INVITE LINK */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-sm rounded-xl shadow-2xl p-5 border ${
              isDark ? "bg-[#222e35] border-gray-700 text-white" : "bg-white border-gray-200 text-gray-800"
            }`}
            style={{ animation: "scaleUp 0.15s ease-out" }}
          >
            <div className="flex justify-between items-center border-b pb-2 mb-4 border-black/10 dark:border-white/10">
              <h3 className="font-bold text-sm flex items-center gap-1.5">🔗 Join Group by Invite Link</h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer text-gray-500"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateInviteGroup} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase opacity-65 mb-1 block">Group Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Coding Enthusiasts 💻"
                  value={inviteGroupName}
                  onChange={(e) => setInviteGroupName(e.target.value)}
                  className={`w-full p-2.5 text-xs rounded border outline-none focus:ring-1 focus:ring-[#00a884] ${
                    isDark ? "bg-[#2a3942] border-gray-600 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase opacity-65 mb-1 block">Invite Link (URL)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., https://chat.whatsapp.com/EnthusiastsCode"
                  value={inviteLink}
                  onChange={(e) => setInviteLink(e.target.value)}
                  className={`w-full p-2.5 text-xs rounded border outline-none focus:ring-1 focus:ring-[#00a884] ${
                    isDark ? "bg-[#2a3942] border-gray-600 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-[#00a884] hover:bg-[#008069] text-white rounded text-xs font-bold shadow-md cursor-pointer transition-colors"
                id="join-group-confirm-btn"
              >
                Join Group 🚀
              </button>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG MODAL 2: LINKED DEVICES (MULTI-DEVICE VISUALIZER) */}
      {showMultiDeviceModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-xl shadow-2xl p-5 border transition-all ${
              isDark ? "bg-[#222e35] border-gray-700 text-white" : "bg-white border-gray-200 text-gray-800"
            }`}
            style={{ animation: "scaleUp 0.15s ease-out" }}
          >
            <div className="flex justify-between items-center border-b pb-2 mb-4 border-black/10 dark:border-white/10">
              <h3 className="font-bold text-sm flex items-center gap-1.5">💻 WhatsApp Multi-Device Sync</h3>
              <button
                onClick={() => setShowMultiDeviceModal(false)}
                className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer text-gray-500"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs opacity-75 leading-relaxed mb-4">
              Your messages are protected with end-to-end encryption and sync seamlessly without requiring your primary phone to remain online.
            </p>

            {/* CONNECTION STATUS OR PAIRING INTERFACE */}
            {whatsappStatus === "connected" && connectedUser ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-[#00a884]/30 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#00a884]/20 flex items-center justify-center text-lg">
                      🟢
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#111b21] dark:text-[#e9edef]">{connectedUser.name || "WhatsApp User"}</h4>
                      <p className="text-[11px] text-[#00a884] font-medium">+{connectedUser.phoneNumber} • Live Synced</p>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnectWhatsapp}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    Log Out
                  </button>
                </div>
                <p className="text-[11px] opacity-70 text-center">
                  Your WhatsApp messages and chats are actively synchronizing in real time.
                </p>
                <div className="mt-3 p-2.5 rounded-xl bg-[#00a884]/10 border border-[#00a884]/20 text-[11px] text-center text-[#00a884] dark:text-[#00e676] leading-relaxed">
                  🕒 <b>Sync Policy:</b> শুধুমাত্র গত ৩ মাসের মধ্যে কথোপকথন হওয়া প্রোফাইলগুলোই সিঙ্ক হবে (Profiles with active conversation in the last 3 months).
                </div>
              </div>
            ) : (
              <div>
                {/* Server Connection Status & Config Button */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-xs mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isSocketConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 animate-ping'}`} />
                    <span className="font-semibold text-[11px] truncate">
                      {isSocketConnected ? 'সার্ভার সংযুক্ত (Connected)' : 'সার্ভারে কানেক্ট হচ্ছে...'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setCustomServerInput(activeServerUrl || "");
                      setShowServerModal(true);
                    }}
                    className="text-[11px] text-[#00a884] dark:text-[#00e676] font-bold hover:underline cursor-pointer flex items-center gap-1 shrink-0 ml-2"
                  >
                    <Settings size={13} /> সার্ভার ইউআরএল
                  </button>
                </div>

                {!isSocketConnected && (
                  <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs">
                    <p className="font-bold flex items-center gap-1.5 mb-1">
                      ⚠️ ব্যাকএন্ড সার্ভারের সাথে কানেক্ট হতে পারছে না
                    </p>
                    <p className="text-[10px] opacity-85 leading-relaxed">
                      অ্যাপটি বর্তমানে <b>{activeServerUrl || "সার্ভার"}</b> এ কানেক্ট করার চেষ্টা করছে। ক্লাউড সার্ভার সিলেক্ট করতে বা ইউআরএল চেক করতে নিচে ট্যাপ করুন:
                    </p>
                    <button
                      onClick={() => {
                        setCustomServerInput(activeServerUrl || "");
                        setShowServerModal(true);
                      }}
                      className="mt-2 text-[11px] font-bold underline cursor-pointer text-[#00a884] dark:text-[#00e676]"
                    >
                      সার্ভার ইউআরএল পরিবর্তন / চেক করুন
                    </button>
                  </div>
                )}

                {/* TABS: QR CODE vs PHONE PAIRING */}
                <div className="flex rounded-lg bg-black/5 dark:bg-white/5 p-1 mb-4">
                  <button
                    onClick={() => {
                      setPairingMode("qr");
                      setShowPhoneInput(false);
                      if (whatsappStatus === "disconnected") {
                        handleStartPairing();
                      }
                    }}
                    className={`flex-1 py-2 rounded-md text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      pairingMode === "qr"
                        ? "bg-white dark:bg-[#202c33] text-[#00a884] shadow-sm"
                        : "text-gray-500 hover:text-inherit"
                    }`}
                  >
                    <QrCode size={15} />
                    <span>Scan QR Code</span>
                  </button>

                  <button
                    onClick={() => {
                      setPairingMode("phone");
                      setShowPhoneInput(true);
                    }}
                    className={`flex-1 py-2 rounded-md text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      pairingMode === "phone"
                        ? "bg-white dark:bg-[#202c33] text-[#00a884] shadow-sm"
                        : "text-gray-500 hover:text-inherit"
                    }`}
                  >
                    <Phone size={15} />
                    <span>Link with Phone</span>
                  </button>
                </div>

                {/* ERROR DISPLAY */}
                {whatsappError && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs leading-relaxed flex items-center justify-between">
                    <span>⚠️ {whatsappError}</span>
                    <button
                      onClick={() => {
                        if (pairingMode === "phone" && phoneNumber) {
                          handleStartPairing(phoneNumber);
                        } else {
                          handleStartPairing();
                        }
                      }}
                      className="ml-2 font-bold underline hover:opacity-80 shrink-0 cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* TAB 1: QR CODE */}
                {pairingMode === "qr" && (
                  <div className="p-4 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-center">
                    {whatsappStatus === "connecting" && (
                      <div className="flex flex-col items-center py-8 justify-center gap-3">
                        <RefreshCw className="animate-spin text-[#00a884]" size={32} />
                        <div>
                          <p className="text-xs font-bold text-[#00a884]">Connecting to WhatsApp...</p>
                          <p className="text-[11px] opacity-70 mt-1">Generating your live QR Code</p>
                        </div>
                      </div>
                    )}

                    {whatsappStatus === "qr-ready" && qrCodeData && (
                      <div className="flex flex-col items-center gap-3">
                        <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-lg">
                          <img src={qrCodeData} alt="WhatsApp QR Code" className="w-52 h-52 mx-auto" />
                        </div>
                        <div className="space-y-1.5 max-w-[300px]">
                          <p className="text-xs font-semibold text-[#00a884]">QR Code Ready to Scan!</p>
                          <ol className="text-left text-[11px] opacity-80 space-y-1 list-decimal list-inside leading-snug">
                            <li>Open WhatsApp on your phone</li>
                            <li>Tap Menu (⋮) or Settings &gt; <b>Linked Devices</b></li>
                            <li>Tap <b>Link a Device</b> and point camera here</li>
                          </ol>
                        </div>

                        <div className="flex gap-2 w-full mt-2 pt-2 border-t border-black/5 dark:border-white/5">
                          <button
                            onClick={() => handleStartPairing()}
                            className="flex-1 py-1.5 bg-[#00a884]/15 hover:bg-[#00a884]/25 text-[#00a884] font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <RefreshCw size={13} /> Refresh QR
                          </button>
                          <button
                            onClick={handleDisconnectWhatsapp}
                            className="px-4 py-1.5 text-xs opacity-75 hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {whatsappStatus === "disconnected" && (
                      <div className="py-6 flex flex-col items-center gap-3">
                        <div className="w-14 h-14 rounded-full bg-[#00a884]/15 text-[#00a884] flex items-center justify-center">
                          <QrCode size={28} />
                        </div>
                        <div>
                          <h4 className="font-bold text-xs">Scan QR Code to Login</h4>
                          <p className="text-[11px] opacity-75 mt-0.5">
                            Click below to generate a real-time WhatsApp QR code
                          </p>
                        </div>
                        <button
                          onClick={() => handleStartPairing()}
                          className="mt-2 px-6 py-2.5 bg-[#00a884] hover:bg-[#008069] text-white font-bold text-xs rounded-xl shadow transition-all cursor-pointer flex items-center gap-2 active:scale-95"
                        >
                          <QrCode size={15} />
                          Generate WhatsApp QR Code
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: PHONE NUMBER PAIRING CODE */}
                {pairingMode === "phone" && (
                  <div className="p-4 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                    <h4 className="text-xs font-bold mb-1 flex items-center gap-1 text-[#00a884]">
                      📞 Link with 8-Digit Pairing Code
                    </h4>
                    <p className="text-[11px] opacity-75 mb-3 leading-relaxed">
                      Enter your mobile number with country code (e.g. +8801XXXXXXXX or 017XXXXXXXX) to get your pairing code.
                    </p>

                    <div className="flex gap-2">
                      <input
                        type="tel"
                        placeholder="e.g. 01712345678 or +88017..."
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="flex-1 bg-white dark:bg-gray-800 border border-black/15 dark:border-white/15 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#00a884] text-inherit"
                        disabled={whatsappStatus === "connecting"}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && phoneNumber && whatsappStatus !== "connecting") {
                            handleStartPairing(phoneNumber);
                          }
                        }}
                      />
                      <button
                        onClick={() => handleStartPairing(phoneNumber)}
                        disabled={!phoneNumber.trim() || whatsappStatus === "connecting"}
                        className="bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer shrink-0"
                      >
                        {whatsappStatus === "connecting" ? "Loading..." : "Get Code"}
                      </button>
                    </div>

                    {whatsappStatus === "connecting" && (
                      <div className="mt-4 py-4 flex flex-col items-center justify-center gap-2">
                        <RefreshCw className="animate-spin text-[#00a884]" size={22} />
                        <p className="text-[11px] opacity-75 font-medium">Requesting Pairing Code from WhatsApp...</p>
                      </div>
                    )}

                    {whatsappStatus === "pairing-code-ready" && pairingCode && (
                      <div className="mt-4 p-4 rounded-xl bg-[#00a884]/10 border border-[#00a884]/30 text-center animate-in fade-in zoom-in-95">
                        <p className="text-xs font-bold text-[#00a884] mb-2">
                          আপনার পেয়ারিং কোড প্রস্তুত (Pairing Code Ready):
                        </p>
                        
                        {/* 8-character Pairing Code with 1-click copy */}
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <div className="bg-white dark:bg-[#1f2c34] border-2 border-[#00a884] text-[#00a884] dark:text-[#00e676] font-mono font-black text-2xl sm:text-3xl tracking-widest px-5 py-2.5 rounded-xl shadow-md select-all">
                            {pairingCode.length === 8 ? `${pairingCode.slice(0, 4)} - ${pairingCode.slice(4)}` : pairingCode}
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(pairingCode);
                              setCopiedPairingCode(true);
                              setTimeout(() => setCopiedPairingCode(false), 2500);
                            }}
                            className="p-3 rounded-xl bg-[#00a884] text-white hover:bg-[#008069] transition-all cursor-pointer shadow active:scale-95"
                            title="Copy Code"
                          >
                            {copiedPairingCode ? <Check size={20} /> : <Copy size={20} />}
                          </button>
                        </div>
                        {copiedPairingCode && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold mb-2 block animate-pulse">
                            ✓ কোড কপি হয়েছে!
                          </span>
                        )}

                        {/* Push Notification Help Alert Box with IP Insight */}
                        <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-left">
                          <div className="flex items-start gap-2">
                            <span className="text-base shrink-0 leading-none">🛡️</span>
                            <div>
                              <h5 className="text-[11px] font-extrabold text-amber-600 dark:text-amber-400">
                                ক্লাউড সার্ভার সিকিউরিটি ও পুশ নোটিফিকেশন তথ্য:
                              </h5>
                              <p className="text-[10px] opacity-80 mt-0.5 leading-relaxed">
                                রিকোয়েস্টটি দূরবর্তী ক্লাউড সার্ভার (Google Cloud/AWS) আইপি থেকে যাওয়ার কারণে WhatsApp নিরাপত্তার স্বার্থে সরাসরি ফোনে নোটিফিকেশন পুশ করে না। তবে জেনারেট হওয়া পেয়ারিং কোডটি মেটার সার্ভারে ১০০% সক্রিয়। নোটিফিকেশন ছাড়াই সরাসরি লিঙ্ক করতে নিচের ধাপগুলো অনুসরণ করুন:
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Exact Step-by-Step Instructions */}
                        <ol className="text-left text-[11px] opacity-90 mt-3 space-y-1.5 list-decimal list-inside leading-snug border-t border-black/10 dark:border-white/10 pt-3">
                          <li>আপনার ফোনের <b>WhatsApp</b> অ্যাপ ওপেন করুন</li>
                          <li>উপরে ডানপাশের ৩টি ডট (<b>⋮</b>) বা <b>Settings &gt; Linked Devices</b>-এ যান</li>
                          <li><b>"Link a Device"</b> (ডিভাইস লিঙ্ক করুন)-এ চাপুন</li>
                          <li>ক্যামেরা স্ক্যানার চালু হলে একদম নিচে দেখুন: <b>"Link with phone number instead"</b> (বা <b>"ফোন নম্বর দিয়ে লিঙ্ক করুন"</b>)-এ চাপ দিন</li>
                          <li>উপরের ৮ ডিজিটের কোডটি (<b className="font-mono text-[#00a884]">{pairingCode}</b>) টাইপ করুন</li>
                        </ol>

                        <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-black/10 dark:border-white/10">
                          <button
                            onClick={() => handleStartPairing(phoneNumber)}
                            className="text-xs text-[#00a884] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw size={12} /> নতুন কোড চান? (Refresh)
                          </button>
                          <button
                            onClick={() => setPairingMode("qr")}
                            className="text-xs text-gray-500 hover:text-[#00a884] font-medium flex items-center gap-1 cursor-pointer"
                          >
                            <QrCode size={13} /> QR স্ক্যান করুন
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. NEW CHAT DRAWER PANEL */}
      <AnimatePresence>
        {showNewChatDrawer && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "tween", duration: 0.22 }}
            className={`absolute inset-0 z-40 flex flex-col select-none ${
              isDark ? "bg-[#0b141a] text-[#e9edef]" : "bg-white text-[#111b21]"
            }`}
          >
            {/* Header */}
            <div className={`px-5 py-4 flex items-center gap-6 shrink-0 shadow-sm ${
              isDark ? "bg-[#202c33]" : "bg-[#008069] text-white"
            }`}>
              <button
                onClick={() => {
                  setShowNewChatDrawer(false);
                  setShowKeypad(false);
                }}
                className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-inherit cursor-pointer transition-colors"
                title="Back to chats"
              >
                <ArrowLeft size={20} />
              </button>
              <h3 className="font-bold text-base flex-1">
                {showKeypad ? "Dial Phone Number" : "New Chat"}
              </h3>
              <button
                onClick={() => setShowKeypad(!showKeypad)}
                className={`p-2 rounded-lg transition-colors cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 flex items-center gap-1 text-xs font-bold ${
                  showKeypad 
                    ? "bg-emerald-500/20 text-[#00e676]" 
                    : "text-inherit"
                }`}
                title="Phone Keypad / Dialer"
              >
                <LayoutGrid size={18} />
                Dialer
              </button>
            </div>

            {/* Body area */}
            {showKeypad ? (
              /* PHONE KEYPAD DIALER INTERFACE */
              <div className="flex-1 flex flex-col p-6 overflow-y-auto min-h-0 bg-black/5 dark:bg-white/5">
                <div className="text-center mb-4">
                  <p className="text-xs opacity-75 mb-1">Enter a phone number to message immediately</p>
                  <p className="text-[10px] opacity-50">Saves as a temporary contact automatically</p>
                </div>

                {/* Display field */}
                <div className="relative mb-6">
                  <input
                    type="text"
                    value={dialNumber}
                    readOnly
                    placeholder="e.g. +8801700000000"
                    className="w-full text-center text-2xl font-semibold tracking-wide bg-transparent border-b-2 border-emerald-500 py-3 focus:outline-none text-inherit placeholder:opacity-25"
                  />
                  {dialNumber && (
                    <button
                      onClick={() => setDialNumber("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-60 hover:opacity-100 font-bold hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Keypad Buttons Grid */}
                <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto w-full mb-8">
                  {[
                    { num: "1", sub: " " },
                    { num: "2", sub: "ABC" },
                    { num: "3", sub: "DEF" },
                    { num: "4", sub: "GHI" },
                    { num: "5", sub: "JKL" },
                    { num: "6", sub: "MNO" },
                    { num: "7", sub: "PQRS" },
                    { num: "8", sub: "TUV" },
                    { num: "9", sub: "WXYZ" },
                    { num: "+", sub: " " },
                    { num: "0", sub: " " },
                  ].map((k) => (
                    <button
                      key={k.num}
                      onClick={() => setDialNumber((prev) => prev + k.num)}
                      className="h-14 rounded-full flex flex-col items-center justify-center bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer border border-black/5 dark:border-white/5"
                    >
                      <span className="text-lg font-bold">{k.num}</span>
                      <span className="text-[8px] tracking-wider opacity-60 font-semibold">{k.sub}</span>
                    </button>
                  ))}
                  {/* Backspace Button */}
                  <button
                    onClick={() => setDialNumber((prev) => prev.slice(0, -1))}
                    className="h-14 rounded-full flex items-center justify-center bg-red-500/5 hover:bg-red-500/15 text-red-500 dark:text-red-400 active:scale-95 transition-all cursor-pointer border border-red-500/10"
                    title="Delete last digit"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Start Chat Button */}
                <button
                  onClick={() => {
                    if (!dialNumber.trim()) return;
                    if (onAddNewContact) {
                      onAddNewContact(`+${dialNumber.trim().replace(/[^0-9]/g, "")}`, dialNumber.trim());
                      setDialNumber("");
                      setShowNewChatDrawer(false);
                      setShowKeypad(false);
                    }
                  }}
                  disabled={!dialNumber.trim()}
                  className="w-full max-w-[280px] mx-auto py-3.5 bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white font-extrabold text-sm rounded-xl transition-all cursor-pointer text-center shadow-lg active:scale-95 flex items-center justify-center gap-2"
                >
                  <MessageSquarePlus size={18} />
                  Start Conversation
                </button>
              </div>
            ) : (
              /* DEFAULT NEW CHAT FLOW (Options & Contacts List) */
              <div className="flex-1 flex flex-col min-h-0">
                {/* Search */}
                <div className="p-3 shrink-0">
                  <div className={`flex items-center gap-4 px-4 py-2 rounded-lg text-sm ${
                    isDark ? "bg-[#202c33]" : "bg-[#f0f2f5]"
                  }`}>
                    <Search size={16} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                    <input
                      type="text"
                      placeholder="Search name or phone number"
                      className="bg-transparent border-none outline-none w-full text-inherit placeholder:opacity-60"
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                {/* Scrollable list of options & grouped contacts */}
                <div className="flex-1 overflow-y-auto divide-y divide-black/5 dark:divide-white/5">
                  {/* 1. Core Quick Launch Options */}
                  <div className="py-2">
                    {/* Option 1: New Group */}
                    <button
                      onClick={() => setShowNewGroupModal(true)}
                      className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-[#00a884] text-white flex items-center justify-center">
                        <Users size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs">New group</h4>
                        <p className="text-[10px] opacity-60">Create a collaborative group conversation</p>
                      </div>
                    </button>

                    {/* Option 2: New Contact */}
                    <button
                      onClick={() => setShowNewContactModal(true)}
                      className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-[#00a884] text-white flex items-center justify-center">
                        <PlusCircle size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs">New contact</h4>
                        <p className="text-[10px] opacity-60">Register a new permanent contact</p>
                      </div>
                    </button>

                    {/* Option 3: New Community */}
                    <button
                      onClick={() => alert("Creating Communities is supported with official business accounts only.")}
                      className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-[#00a884] text-white flex items-center justify-center">
                        <Globe size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs">New community</h4>
                        <p className="text-[10px] opacity-60">Connect neighborhood groups under one space</p>
                      </div>
                    </button>

                    {/* Option 4: Self Chat */}
                    <button
                      onClick={() => {
                        if (onAddNewContact) {
                          onAddNewContact("You (Message Yourself)", "+1234567890");
                          setShowNewChatDrawer(false);
                        }
                      }}
                      className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-[#00e676] flex items-center justify-center font-bold text-xs">
                        YOU
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-emerald-500 dark:text-[#00e676]">Message yourself (You)</h4>
                        <p className="text-[10px] opacity-60">Keep quick notes, audio recordings, or drafts</p>
                      </div>
                    </button>
                  </div>

                  {/* 2. Grouped Alphabetical Contacts List */}
                  <div className="py-2">
                    {Object.keys(getAlphabeticalGroups()).sort().map((letter) => {
                      const groupContacts = getAlphabeticalGroups()[letter].filter((c) =>
                        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (c.phoneNumber && c.phoneNumber.includes(searchQuery))
                      );
                      if (groupContacts.length === 0) return null;

                      return (
                        <div key={letter} className="mb-4">
                          <div className="px-5 py-1.5 text-xs font-black text-[#00a884] dark:text-[#00e676] tracking-wider uppercase bg-black/5 dark:bg-white/5 select-none">
                            {letter}
                          </div>
                          <div className="divide-y divide-black/5 dark:divide-white/5">
                            {groupContacts.map((c) => (
                              <button
                                      key={c.id}
                                      onClick={() => {
                                        onSelectContact(c.id);
                                        setShowNewChatDrawer(false);
                                      }}
                                      className="w-full px-5 py-3 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-left"
                                    >
                                      <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center font-bold text-xs text-inherit overflow-hidden shrink-0">
                                        {c.avatar ? (
                                          <img src={c.avatar} alt={c.name} className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                                        ) : (
                                          c.name.slice(0, 1).toUpperCase()
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <h4 className="font-bold text-xs truncate">{c.name}</h4>
                                          {c.verified && (
                                            <span className="bg-[#00e676] text-[#0b141a] text-[8px] px-1 rounded font-extrabold uppercase">
                                              VERIFIED
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[10px] opacity-60 truncate">{c.about || "Hey there! I am using WhatsApp."}</p>
                                        {c.phoneNumber && (
                                          <p className="text-[9px] opacity-40 font-mono mt-0.5">{c.phoneNumber}</p>
                                        )}
                                      </div>
                                    </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* NEW CONTACT MODAL OVERLAY */}
      {showNewContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-sm rounded-2xl shadow-2xl p-6 border ${
            isDark ? "bg-[#222e35] border-gray-700 text-white" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <h3 className="font-extrabold text-base mb-4 flex items-center gap-2 text-[#00a884]">
              <PlusCircle size={20} /> Register New Contact
            </h3>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-[10px] font-black uppercase opacity-60 mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-inherit"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase opacity-60 mb-1">Phone Number / JID</label>
                <input
                  type="tel"
                  placeholder="e.g. +8801700000000"
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-inherit font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => {
                  setShowNewContactModal(false);
                  setNewContactName("");
                  setNewContactPhone("");
                }}
                className="px-4 py-2 border border-black/10 dark:border-white/10 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!newContactName.trim() || !newContactPhone.trim()) return;
                  if (onAddNewContact) {
                    onAddNewContact(newContactName.trim(), newContactPhone.trim());
                    setNewContactName("");
                    setNewContactPhone("");
                    setShowNewContactModal(false);
                    setShowNewChatDrawer(false);
                  }
                }}
                disabled={!newContactName.trim() || !newContactPhone.trim()}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white rounded-lg font-bold cursor-pointer transition-colors"
              >
                Save Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW GROUP MODAL OVERLAY */}
      {showNewGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-sm rounded-2xl shadow-2xl p-6 border ${
            isDark ? "bg-[#222e35] border-gray-700 text-white" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <h3 className="font-extrabold text-base mb-4 flex items-center gap-2 text-[#00a884]">
              <Users size={20} /> Establish New Group
            </h3>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-[10px] font-black uppercase opacity-60 mb-1">Group Name / Subject</label>
                <input
                  type="text"
                  placeholder="Family Group, Marketing Team etc."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-inherit"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => {
                  setShowNewGroupModal(false);
                  setNewGroupName("");
                }}
                className="px-4 py-2 border border-black/10 dark:border-white/10 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!newGroupName.trim()) return;
                  handleCreateNewGroupLocal();
                }}
                disabled={!newGroupName.trim()}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white rounded-lg font-bold cursor-pointer transition-colors"
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING WHATSAPP LONG-PRESS & RIGHT-CLICK CONTEXT MENU MODAL */}
      {contextMenuTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center sm:block"
          onClick={() => {
            setContextMenuTarget(null);
            setActiveSubMenu(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenuTarget(null);
            setActiveSubMenu(null);
          }}
        >
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/25 backdrop-blur-[1px] transition-opacity" />

          {/* Context Menu Container */}
          <div
            className={`fixed z-50 w-[240px] sm:w-[250px] rounded-2xl shadow-2xl border transition-all select-none overflow-visible ${
              isDark
                ? "bg-[#233138] border-gray-700/80 text-[#e9edef]"
                : "bg-white border-gray-200/90 text-[#111b21]"
            }`}
            style={computeContextMenuPosition(contextMenuTarget.position)}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Contact Top Preview Card (identical to user screenshot) */}
            <div
              className={`px-3.5 py-3 flex items-center gap-3 border-b rounded-t-2xl ${
                isDark ? "bg-[#1f2c34] border-gray-700/60" : "bg-gray-50/95 border-gray-100"
              }`}
            >
              <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-black flex items-center justify-center">
                {contextMenuTarget.contact.avatar === "letter-S" ? (
                  <div className="w-full h-full bg-[#6b42f5] text-white flex items-center justify-center font-bold text-sm">
                    S
                  </div>
                ) : contextMenuTarget.contact.avatar && contextMenuTarget.contact.avatar !== "black-circle" ? (
                  <img
                    src={contextMenuTarget.contact.avatar}
                    alt={contextMenuTarget.contact.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-black rounded-full" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-sm truncate text-[#111b21] dark:text-[#e9edef]">
                  {contextMenuTarget.contact.name}
                </h4>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  <CheckCheck size={14} className="text-[#53bdeb] shrink-0" />
                  <Mic size={13} className="text-[#00a884] shrink-0" />
                  <span className="text-[11px] font-medium">0:03</span>
                </div>
              </div>
            </div>

            {/* Exact 9 Menu Options from Screenshot */}
            <div className="py-1 text-[13.5px]">
              {/* 1. Archive chat */}
              <button
                onClick={() => {
                  if (onArchiveContact) {
                    onArchiveContact(contextMenuTarget.contact.id, !contextMenuTarget.contact.archive);
                  }
                  setContextMenuTarget(null);
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-3 cursor-pointer transition-colors"
              >
                <Archive size={17} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                <span>{contextMenuTarget.contact.archive ? "Unarchive chat" : "Archive chat"}</span>
              </button>

              {/* 2. Mute notifications (Submenu) */}
              <div className="relative">
                <button
                  onClick={() => {
                    if (contextMenuTarget.contact.isMuted) {
                      onUpdateContactSettings?.(contextMenuTarget.contact.id, {
                        isMuted: false,
                        muteDuration: undefined,
                      });
                      setContextMenuTarget(null);
                    } else {
                      setActiveSubMenu(activeSubMenu === "mute" ? null : "mute");
                    }
                  }}
                  onMouseEnter={() => {
                    if (!contextMenuTarget.contact.isMuted) {
                      setActiveSubMenu("mute");
                    }
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <BellOff size={17} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                    <span>{contextMenuTarget.contact.isMuted ? "Unmute notifications" : "Mute notifications"}</span>
                  </div>
                  {!contextMenuTarget.contact.isMuted && (
                    <ChevronRight size={14} className="text-gray-400 shrink-0" />
                  )}
                </button>

                {/* Submenu for mute duration */}
                {activeSubMenu === "mute" && !contextMenuTarget.contact.isMuted && (
                  <div
                    className={`absolute left-full top-0 ml-1 w-36 rounded-xl shadow-xl border py-1 z-30 ${
                      isDark ? "bg-[#233138] border-gray-700 text-[#e9edef]" : "bg-white border-gray-200 text-[#111b21]"
                    }`}
                  >
                    {["8 hours", "1 week", "Always"].map((duration) => (
                      <button
                        key={duration}
                        onClick={() => {
                          onUpdateContactSettings?.(contextMenuTarget.contact.id, {
                            isMuted: true,
                            muteDuration: duration,
                          });
                          setContextMenuTarget(null);
                          setActiveSubMenu(null);
                        }}
                        className="w-full text-left px-3.5 py-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-xs font-medium cursor-pointer transition-colors"
                      >
                        {duration}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. Pin chat */}
              <button
                onClick={() => {
                  onUpdateContactSettings?.(contextMenuTarget.contact.id, {
                    isPinned: !contextMenuTarget.contact.isPinned,
                  });
                  setContextMenuTarget(null);
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-3 cursor-pointer transition-colors"
              >
                <Pin size={17} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                <span>{contextMenuTarget.contact.isPinned ? "Unpin chat" : "Pin chat"}</span>
              </button>

              {/* 4. Mark as unread */}
              <button
                onClick={() => {
                  onUpdateContactSettings?.(contextMenuTarget.contact.id, {
                    unreadCount: contextMenuTarget.contact.unreadCount > 0 ? 0 : 1,
                  });
                  setContextMenuTarget(null);
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-3 cursor-pointer transition-colors"
              >
                <Mail size={17} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                <span>{contextMenuTarget.contact.unreadCount > 0 ? "Mark as read" : "Mark as unread"}</span>
              </button>

              {/* 5. Add to Favorites */}
              <button
                onClick={() => {
                  onUpdateContactSettings?.(contextMenuTarget.contact.id, {
                    isFavorite: !contextMenuTarget.contact.isFavorite,
                  });
                  setContextMenuTarget(null);
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-3 cursor-pointer transition-colors"
              >
                <Heart
                  size={17}
                  className={`shrink-0 ${
                    contextMenuTarget.contact.isFavorite
                      ? "fill-red-500 text-red-500"
                      : "text-[#54656f] dark:text-[#aebac1]"
                  }`}
                />
                <span>{contextMenuTarget.contact.isFavorite ? "Remove from Favorites" : "Add to Favorites"}</span>
              </button>

              {/* 6. Add to list (Submenu) */}
              <div className="relative">
                <button
                  onClick={() => setActiveSubMenu(activeSubMenu === "list" ? null : "list")}
                  onMouseEnter={() => setActiveSubMenu("list")}
                  className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <ListPlus size={17} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                    <span>Add to list</span>
                  </div>
                  <ChevronRight size={14} className="text-gray-400 shrink-0" />
                </button>

                {/* Submenu for lists */}
                {activeSubMenu === "list" && (
                  <div
                    className={`absolute left-full top-0 ml-1 w-36 rounded-xl shadow-xl border py-1 z-30 ${
                      isDark ? "bg-[#233138] border-gray-700 text-[#e9edef]" : "bg-white border-gray-200 text-[#111b21]"
                    }`}
                  >
                    {["Friends", "Family", "Work", "Favorites"].map((listName) => (
                      <button
                        key={listName}
                        onClick={() => {
                          onUpdateContactSettings?.(contextMenuTarget.contact.id, {
                            listName,
                          });
                          setContextMenuTarget(null);
                          setActiveSubMenu(null);
                        }}
                        className="w-full text-left px-3.5 py-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-xs font-medium cursor-pointer transition-colors"
                      >
                        {listName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Divider Line */}
              <div className="border-t border-gray-100 dark:border-gray-700/60 my-1" />

              {/* 7. Block */}
              <button
                onClick={() => {
                  onUpdateContactSettings?.(contextMenuTarget.contact.id, {
                    isBlocked: !contextMenuTarget.contact.isBlocked,
                  });
                  setContextMenuTarget(null);
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-3 cursor-pointer transition-colors"
              >
                <Ban size={17} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                <span>{contextMenuTarget.contact.isBlocked ? "Unblock" : "Block"}</span>
              </button>

              {/* 8. Clear chat */}
              <button
                onClick={() => {
                  if (confirm(`Clear chat with ${contextMenuTarget.contact.name}?`)) {
                    onClearChat?.(contextMenuTarget.contact.id);
                  }
                  setContextMenuTarget(null);
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-3 cursor-pointer transition-colors"
              >
                <MinusCircle size={17} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
                <span>Clear chat</span>
              </button>

              {/* 9. Delete chat */}
              <button
                onClick={() => {
                  if (confirm(`Delete chat with ${contextMenuTarget.contact.name}?`)) {
                    onDeleteChat?.(contextMenuTarget.contact.id);
                  }
                  setContextMenuTarget(null);
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-3 cursor-pointer transition-colors text-red-500"
              >
                <Trash2 size={17} className="text-red-500 shrink-0" />
                <span>Delete chat</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SERVER SETTINGS MODAL */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-sm rounded-2xl shadow-2xl p-6 border ${
            isDark ? "bg-[#222e35] border-gray-700 text-white" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <h3 className="font-extrabold text-base mb-2 flex items-center gap-2 text-[#00a884]">
              <Settings size={20} /> ব্যাকএন্ড সার্ভার সেটিংস
            </h3>
            <p className="text-xs opacity-75 mb-4 leading-relaxed">
              মোবাইল অ্যাপ বা ব্রাউজার যে WhatsApp Baileys ব্যাকএন্ড সার্ভারের সাথে যোগাযোগ করবে তার ইউআরএল:
            </p>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-[10px] font-black uppercase opacity-60 mb-1">
                  সার্ভার ইউআরএল (Server URL)
                </label>
                <input
                  type="text"
                  placeholder="https://... বা http://127.0.0.1:3000"
                  value={customServerInput}
                  onChange={(e) => setCustomServerInput(e.target.value)}
                  className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-mono text-inherit"
                />
              </div>

              {/* Quick Select Buttons */}
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] font-bold opacity-60">দ্রুত নির্বাচন করুন (Quick Select):</p>
                <button
                  type="button"
                  onClick={() => setCustomServerInput("https://ais-pre-qkpd3ywpqroikeei6ilayf-233775012847.asia-southeast1.run.app")}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-[#00a884] dark:text-[#00e676] text-xs font-semibold flex items-center justify-between cursor-pointer"
                >
                  <span>🌐 লাইভ ক্লাউড সার্ভার (Live Cloud)</span>
                  <span className="text-[9px] opacity-60">অনলাইন</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCustomServerInput("http://127.0.0.1:3000")}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-xs font-semibold flex items-center justify-between cursor-pointer"
                >
                  <span>📱 অন-ডিভাইস / Termux (127.0.0.1:3000)</span>
                  <span className="text-[9px] opacity-60">লোকাল</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setShowServerModal(false)}
                className="px-4 py-2 border border-black/10 dark:border-white/10 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 font-bold cursor-pointer"
              >
                বাতিল (Cancel)
              </button>
              <button
                onClick={() => {
                  if (onUpdateServerUrl) {
                    onUpdateServerUrl(customServerInput.trim());
                  }
                  setShowServerModal(false);
                }}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg font-bold cursor-pointer transition-colors shadow"
              >
                সংরক্ষণ ও রিকানেক্ট (Save & Connect)
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
};
