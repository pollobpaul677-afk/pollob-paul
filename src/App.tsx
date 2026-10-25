import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { io } from "socket.io-client";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { IntroScreen } from "./components/IntroScreen";
import { ProfileModal } from "./components/ProfileModal";
import { ChatSearch } from "./components/ChatSearchModal";
import { MessageInput } from "./components/MessageInput";
import { ContactInfoView } from "./components/ContactInfoView";
import { Contact, Message, UserProfile } from "./types";
import { initialContacts, initialChats } from "./data/initialChats";
import { playSentSound, playReceivedSound } from "./lib/sound";
import { saveChatHistory, saveSetting, loadAllChats, loadSetting, loadChatHistory } from "./lib/indexedDB";

const isRealContact = (id: string) => 
  id.includes("@s.whatsapp.net") || 
  id.includes("@g.us") || 
  id.includes("@lid") || 
  id.includes("@newsletter");

function formatPhoneNumber(rawDigits: string): string {
  const digits = rawDigits.replace(/\D/g, "");
  if (!digits) return rawDigits;
  if (digits.startsWith("880") && digits.length >= 12) {
    const local = digits.slice(3);
    return `+880 ${local.slice(0, 4)}-${local.slice(4)}`;
  }
  if (digits.startsWith("88") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+88 ${local.slice(0, 4)}-${local.slice(4)}`;
  }
  if (digits.startsWith("01") && digits.length === 11) {
    return `+880 ${digits.slice(1, 5)}-${digits.slice(5)}`;
  }
  if (digits.startsWith("1") && digits.length === 11) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length >= 8) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

function getFallbackContactName(id: string, name?: string, phone?: string): string {
  if (name && !name.includes("@") && isNaN(Number(name))) {
    return name;
  }
  const rawIdDigits = id.split("@")[0].replace(/\D/g, "");
  const phoneDigits = phone ? phone.replace(/\D/g, "") : "";
  if (phone && phoneDigits !== rawIdDigits && phoneDigits.length >= 7 && phoneDigits.length <= 13) {
    return phone;
  }
  if (id.endsWith("@g.us")) return "WhatsApp Group";
  if (id.endsWith("@newsletter")) return "WhatsApp Channel";
  if (id.includes("@s.whatsapp.net")) {
    return formatPhoneNumber(id.split("@")[0]);
  }
  return "WhatsApp User";
}

export default function App() {
  const [socket, setSocket] = useState<any>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<"disconnected" | "connecting" | "qr-ready" | "pairing-code-ready" | "connected">("disconnected");
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string>("");
  const [connectedUser, setConnectedUser] = useState<any>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [batteryStatus, setBatteryStatus] = useState<{ value: number; isCharging: boolean } | null>(null);

  const [contacts, setContacts] = useState<Contact[]>(() => {
    const saved = localStorage.getItem("wa_contacts");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Error parsing wa_contacts", e);
      }
    }
    return initialContacts;
  });

  const [chats, setChats] = useState<Record<string, Message[]>>(() => {
    const saved = localStorage.getItem("wa_chats");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Error parsing wa_chats", e);
      }
    }
    
    // Convert array structure of initialChats to Record mapping contactId -> Messages
    const record: Record<string, Message[]> = {};
    initialChats.forEach((c) => {
      record[c.contactId] = c.messages;
    });
    return record;
  });

  const [activeContactId, setActiveContactId] = useState<string | null>(() => {
    // If we're on mobile/small screen (less than 768px), start with null so user sees chat list
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return null;
    }
    return "contact-1"; // Set first contact active by default on desktop
  });

  const activeContactIdRef = useRef<string | null>(activeContactId);
  useEffect(() => {
    activeContactIdRef.current = activeContactId;
  }, [activeContactId]);
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("wa_theme");
    return saved ? saved === "dark" : false; // Default to light mode to match user image
  });

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem("wa_user_profile");
    return saved
      ? JSON.parse(saved)
      : {
          name: "John Doe",
          about: "Available",
          avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
          phoneNumber: "+880 1512-345678",
        };
  });

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);
  const [viewingContactProfileId, setViewingContactProfileId] = useState<string | null>(null);

  // Quoted reply state
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);

  // Load initial data from IndexedDB (with localStorage migration fallback)
  useEffect(() => {
    async function loadInitialData() {
      try {
        console.log("Initializing IndexedDB & loading data...");
        // 1. Load theme
        const savedTheme = await loadSetting<string | null>("wa_theme", null);
        if (savedTheme) {
          setIsDark(savedTheme === "dark");
        } else {
          // Fallback to localStorage
          const localTheme = localStorage.getItem("wa_theme");
          if (localTheme) {
            setIsDark(localTheme === "dark");
            await saveSetting("wa_theme", localTheme);
          }
        }

        // 2. Load contacts
        const savedContacts = await loadSetting<Contact[] | null>("wa_contacts", null);
        if (savedContacts && savedContacts.length > 0) {
          const sanitized = savedContacts.map((c) => ({
            ...c,
            name: getFallbackContactName(c.id, c.name, c.phoneNumber),
          }));
          setContacts(sanitized);
        } else {
          // Fallback to localStorage
          const localContactsStr = localStorage.getItem("wa_contacts");
          if (localContactsStr) {
            try {
              const localContacts = JSON.parse(localContactsStr);
              const sanitized = Array.isArray(localContacts)
                ? localContacts.map((c: any) => ({
                    ...c,
                    name: getFallbackContactName(c.id, c.name, c.phoneNumber),
                  }))
                : localContacts;
              setContacts(sanitized);
              await saveSetting("wa_contacts", sanitized);
            } catch (e) {
              console.error("Error migrating localContacts", e);
            }
          }
        }

        // 3. Load userProfile
        const savedProfile = await loadSetting<UserProfile | null>("wa_user_profile", null);
        if (savedProfile) {
          setUserProfile(savedProfile);
        } else {
          // Fallback to localStorage
          const localProfileStr = localStorage.getItem("wa_user_profile");
          if (localProfileStr) {
            try {
              const localProfile = JSON.parse(localProfileStr);
              setUserProfile(localProfile);
              await saveSetting("wa_user_profile", localProfile);
            } catch (e) {
              console.error("Error migrating localProfile", e);
            }
          }
        }

        // 4. Load chats
        const savedChats = await loadAllChats();
        if (savedChats && Object.keys(savedChats).length > 0) {
          setChats(savedChats);
        } else {
          // Fallback to localStorage
          const localChatsStr = localStorage.getItem("wa_chats");
          if (localChatsStr) {
            try {
              const localChats = JSON.parse(localChatsStr);
              setChats(localChats);
              // Migrate all chats to IndexedDB
              for (const contactId of Object.keys(localChats)) {
                await saveChatHistory(contactId, localChats[contactId]);
              }
            } catch (e) {
              console.error("Error migrating localChats", e);
            }
          }
        }
        console.log("IndexedDB data loading & migration completed successfully.");
      } catch (err) {
        console.error("Failed to load initial data from IndexedDB:", err);
      }
    }
    loadInitialData();
  }, []);

  // Sync contacts to IndexedDB & fallback to localStorage
  useEffect(() => {
    saveSetting("wa_contacts", contacts);
    try {
      localStorage.setItem("wa_contacts", JSON.stringify(contacts));
    } catch (e) {}
  }, [contacts]);

  // Sync chats to IndexedDB (optimizing to only write contact keys that actually changed)
  const prevChatsRef = useRef<Record<string, Message[]>>({});
  useEffect(() => {
    const prevChats = prevChatsRef.current;
    Object.keys(chats).forEach((contactId) => {
      const currentMessages = chats[contactId] || [];
      const prevMessages = prevChats[contactId] || [];
      
      // If messages array reference changed or length changed, write specifically to IndexedDB
      if (currentMessages !== prevMessages || currentMessages.length !== prevMessages.length) {
        saveChatHistory(contactId, currentMessages);
      }
    });
    prevChatsRef.current = chats;
  }, [chats]);

  // Sync theme to IndexedDB & fallback to localStorage
  useEffect(() => {
    saveSetting("wa_theme", isDark ? "dark" : "light");
    try {
      localStorage.setItem("wa_theme", isDark ? "dark" : "light");
    } catch (e) {}
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  // Sync user profile to IndexedDB & fallback to localStorage
  useEffect(() => {
    saveSetting("wa_user_profile", userProfile);
    try {
      localStorage.setItem("wa_user_profile", JSON.stringify(userProfile));
    } catch (e) {}
  }, [userProfile]);

  // Request notification permissions early
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Sync real-time device battery if Battery API is supported natively (Android / Chrome)
  useEffect(() => {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery().then((batteryObj: any) => {
        const syncBattery = () => {
          const status = {
            value: Math.round(batteryObj.level * 100),
            isCharging: Boolean(batteryObj.charging),
          };
          setBatteryStatus(status);
          if (socket) {
            socket.emit("client:battery-update", status);
          }
        };
        syncBattery();
        batteryObj.addEventListener("levelchange", syncBattery);
        batteryObj.addEventListener("chargingchange", syncBattery);
      }).catch(() => {});
    }
  }, [socket]);

  // Robust backend URL resolver supporting Web Browser, Android APK, and Custom Server URL
  const DEFAULT_CLOUD_URL = "https://ais-pre-qkpd3ywpqroikeei6ilayf-233775012847.asia-southeast1.run.app";

  const getBackendUrl = (): string => {
    if (typeof window !== "undefined") {
      // 1. User configured custom server URL in localStorage
      const saved = localStorage.getItem("wa_server_url");
      if (saved && saved.trim()) {
        return saved.trim().replace(/\/+$/, "");
      }

      // 2. Browser Environment: If not inside Capacitor Android, use current window.location.origin
      const isCapacitorOrLocalNative =
        window.location.protocol === "capacitor:" ||
        window.location.protocol === "file:" ||
        (window.location.hostname === "localhost" && window.location.port !== "3000" && !window.location.port);

      if (!isCapacitorOrLocalNative && (window.location.protocol === "http:" || window.location.protocol === "https:")) {
        return window.location.origin;
      }

      // 3. Android APK / Native Environment: Connect to live Cloud Backend
      const cloudUrl = (import.meta.env.VITE_APP_URL || DEFAULT_CLOUD_URL).replace(/\/+$/, "");
      return cloudUrl;
    }
    return DEFAULT_CLOUD_URL;
  };

  const [activeServerUrl, setActiveServerUrl] = useState<string>(() => getBackendUrl());
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);

  const handleUpdateServerUrl = (newUrl: string) => {
    const clean = newUrl.trim().replace(/\/+$/, "");
    if (clean) {
      localStorage.setItem("wa_server_url", clean);
    } else {
      localStorage.removeItem("wa_server_url");
    }
    const resolved = getBackendUrl();
    setActiveServerUrl(resolved);
    // Force reload socket connection with new server URL
    if (socket) {
      try { socket.disconnect(); } catch (_) {}
    }
    const newSocket = io(resolved, {
      transports: ["polling", "websocket"],
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    setSocket(newSocket);
  };

  // Set up global Socket.io client for real-time WhatsApp updates
  useEffect(() => {
    const currentBackendUrl = getBackendUrl();
    setActiveServerUrl(currentBackendUrl);

    console.log("[Socket.io] Connecting to WhatsApp backend:", currentBackendUrl);

    const newSocket = io(currentBackendUrl, {
      transports: ["polling", "websocket"],
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("[Socket.io] Connected successfully to:", currentBackendUrl);
      setIsSocketConnected(true);
    });

    newSocket.on("disconnect", () => {
      console.warn("[Socket.io] Disconnected from:", currentBackendUrl);
      setIsSocketConnected(false);
    });

    newSocket.on("connect_error", (err: any) => {
      console.error("[Socket.io] Connection error to:", currentBackendUrl, err.message);
      setIsSocketConnected(false);
    });

    newSocket.on("whatsapp-status", (status: any) => {
      setWhatsappStatus(status);
      if (status === "disconnected") {
        setQrCodeData(null);
        setPairingCode("");
        setConnectedUser(null);
        // Reset chats and contacts back to default mock contacts on logout
        setContacts(initialContacts);
        const record: Record<string, Message[]> = {};
        initialChats.forEach((c) => {
          record[c.contactId] = c.messages;
        });
        setChats(record);
      }
    });

    newSocket.on("whatsapp-qr", (qrImage: string) => {
      setQrCodeData(qrImage);
      setWhatsappStatus("qr-ready");
    });

    newSocket.on("whatsapp-pairing-code", (code: string) => {
      setPairingCode(code);
      setWhatsappStatus("pairing-code-ready");
    });

    newSocket.on("user-info", (userInfo: any) => {
      setConnectedUser(userInfo);
      setWhatsappStatus("connected");
      setUserProfile((prev) => ({
        ...prev,
        name: userInfo.name || prev.name,
        phoneNumber: userInfo.phoneNumber ? `+${userInfo.phoneNumber}` : prev.phoneNumber,
      }));
    });

    newSocket.on("whatsapp-error", (errMsg: string) => {
      setWhatsappError(errMsg);
    });

    newSocket.on("whatsapp:battery-status", (data: { value: number; isCharging: boolean }) => {
      if (data && typeof data.value === "number") {
        setBatteryStatus(data);
      }
    });

    newSocket.on("whatsapp-history", (data: { contacts: Contact[]; chats: Record<string, Message[]> }) => {
      console.log("Received synced WhatsApp history (3-month conversation filter):", data);
      if (data.contacts && Array.isArray(data.contacts)) {
        setContacts((prev) => {
          // Sync server's 3-month filtered contacts
          const cleanContacts = data.contacts.map((newC) => {
            const cleanName = getFallbackContactName(newC.id, newC.name, newC.phoneNumber);
            const existing = prev.find((c) => c.id === newC.id);
            return {
              ...newC,
              name: cleanName,
              avatar: newC.avatar || existing?.avatar || "",
              about: newC.about || existing?.about || "",
              phoneNumber: newC.phoneNumber || existing?.phoneNumber,
            };
          });

          return cleanContacts.length > 0 ? cleanContacts : prev;
        });

        const firstContact = data.contacts[0];
        if (firstContact) {
          if (typeof window !== "undefined" && window.innerWidth >= 768) {
            setActiveContactId((prevActive) => prevActive || firstContact.id);
          }
        }
      }
      if (data.chats) {
        setChats((prev) => {
          const updated = { ...prev };
          // Remove non-real mock contacts if migrating/syncing real history
          Object.keys(updated).forEach((k) => {
            if (!isRealContact(k)) {
              delete updated[k];
            }
          });
          
          // Merge incoming message histories
          Object.keys(data.chats).forEach((jid) => {
            const existingMessages = updated[jid] || [];
            const incomingMessages = data.chats[jid] || [];
            
            const mergedMap = new Map<string, Message>();
            existingMessages.forEach((m) => {
              if (m && m.id) mergedMap.set(m.id, m);
            });
            incomingMessages.forEach((m) => {
              if (m && m.id) {
                const existingMsg = mergedMap.get(m.id);
                if (existingMsg) {
                  mergedMap.set(m.id, {
                    ...existingMsg,
                    ...m,
                    fileUrl: m.fileUrl || existingMsg.fileUrl, // preserve local base64 media if new one is empty
                  });
                } else {
                  mergedMap.set(m.id, m);
                }
              }
            });
            
            updated[jid] = Array.from(mergedMap.values());
          });
          
          return updated;
        });
      }
    });

    // ১. নিজের প্রোফাইল তথ্য লোড করা
    newSocket.on("whatsapp:my-profile", (profile: any) => {
      setUserProfile((prev) => ({
        ...prev,
        name: profile.name || prev.name,
        avatar: profile.imgUrl || prev.avatar,
      }));
    });

    // ২. প্রতিটি বন্ধুর ছবি ব্যাকগ্রাউন্ডে লোড হলে তা রেন্ডার করা (শুধুমাত্র ৩ মাসের সিঙ্ক হওয়া প্রফাইলের জন্য)
    newSocket.on("whatsapp:chat-profile-ready", (data: { jid: string; profile: any }) => {
      setContacts((prev) => {
        const index = prev.findIndex((c) => c.id === data.jid);
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            avatar: data.profile?.imgUrl || updated[index].avatar,
            about: data.profile?.status || updated[index].about,
            name: data.profile?.name || updated[index].name,
            phoneNumber: data.profile?.phoneNumber || updated[index].phoneNumber,
          };
          return updated;
        }
        return prev;
      });
    });

    // ৩. চ্যাট লিস্ট লোড হওয়া (গত ৩ মাসের মধ্যে কথোপকথন হওয়া প্রফাইলগুলোই সুধু সিঙ্ক হবে)
    newSocket.on("whatsapp:chats-loaded", (rawChats: any[]) => {
      console.log(`Received whatsapp:chats-loaded: ${rawChats?.length || 0} profiles active in last 3 months`);
      if (!Array.isArray(rawChats)) return;
      setContacts((prev) => {
        return rawChats.map((rc) => {
          const isGrp = rc.id.endsWith("@g.us") || Boolean(rc.isGroup);
          const cleanName = getFallbackContactName(rc.id, rc.name, rc.phoneNumber);
          const existing = prev.find((c) => c.id === rc.id);
          return {
            id: rc.id,
            name: cleanName,
            avatar: rc.avatar || existing?.avatar || "",
            isGroup: isGrp,
            unreadCount: rc.unreadCount !== undefined ? rc.unreadCount : (existing?.unreadCount || 0),
            about: rc.about || existing?.about || (isGrp ? "WhatsApp Group" : "Hey there! I am using WhatsApp."),
            status: "online" as const,
            phoneNumber: rc.phoneNumber || existing?.phoneNumber,
            conversationTimestamp: rc.conversationTimestamp,
            lastActivityTimestamp: rc.lastActivityTimestamp,
            lastMessage: rc.lastMessage || existing?.lastMessage,
            syncStatus: rc.syncStatus || existing?.syncStatus || {
              synced: false,
              timeSpan: "Last 3 months",
            },
          };
        });
      });
    });

    // ৪. অন-ডিমান্ড কোনো বন্ধুর প্রোফাইল ও ৩ মাসের মেসেজ হিস্ট্রি লোড হওয়া
    const handleTargetHistoryResponse = (data: { jid: string; profile?: any; history: Message[]; syncStatus?: any }) => {
      console.log("Received 3-month target history for", data.jid, "count:", data.history?.length);
      setContacts((prev) => {
        const updated = [...prev];
        const index = updated.findIndex((c) => c.id === data.jid);
        const syncStatus = data.syncStatus || {
          synced: true,
          messageCount: data.history?.length || 0,
          timeSpan: "Last 3 months",
          syncedAt: Date.now(),
        };

        if (index !== -1) {
          updated[index] = {
            ...updated[index],
            avatar: data.profile?.imgUrl || updated[index].avatar,
            about: data.profile?.status || updated[index].about,
            name: data.profile?.name || updated[index].name,
            phoneNumber: data.profile?.phoneNumber || updated[index].phoneNumber,
            unreadCount: 0,
            syncStatus,
          };
        } else {
          const isGrp = data.jid.endsWith("@g.us");
          updated.push({
            id: data.jid,
            name: getFallbackContactName(data.jid, data.profile?.name, data.profile?.phoneNumber),
            avatar: data.profile?.imgUrl || "",
            isGroup: isGrp,
            unreadCount: 0,
            about: data.profile?.status || (isGrp ? "WhatsApp Group" : "Hey there! I am using WhatsApp."),
            status: "online",
            phoneNumber: data.profile?.phoneNumber,
            syncStatus,
          });
        }
        return updated;
      });

      setChats((prev) => {
        const existingMessages = prev[data.jid] || [];
        const incomingMessages = data.history || [];
        
        const mergedMap = new Map<string, Message>();
        existingMessages.forEach((m) => {
          if (m && m.id) mergedMap.set(m.id, m);
        });
        incomingMessages.forEach((m) => {
          if (m && m.id) {
            const existingMsg = mergedMap.get(m.id);
            if (existingMsg) {
              mergedMap.set(m.id, {
                ...existingMsg,
                ...m,
                fileUrl: m.fileUrl || existingMsg.fileUrl,
              });
            } else {
              mergedMap.set(m.id, m);
            }
          }
        });
        
        const finalMessages = Array.from(mergedMap.values());
        // Save targeted history to IndexedDB
        saveChatHistory(data.jid, finalMessages);

        return {
          ...prev,
          [data.jid]: finalMessages,
        };
      });
    };

    newSocket.on("response:target-chat-history", handleTargetHistoryResponse);

    // ৫. মেসেজ সাকসেস ইভেন্ট
    newSocket.on("action:success", (res: { type: string; jid?: string; message?: Message; archived?: boolean }) => {
      const currentActiveId = activeContactIdRef.current;
      if (res.type === "send-text" && res.message && currentActiveId) {
        const msg = res.message;
        setChats((prev) => {
          const current = prev[currentActiveId] || [];
          return {
            ...prev,
            [currentActiveId]: current.map((m) => (m.id === msg.id ? { ...m, status: "read" as const } : m)),
          };
        });
      }
    });

    newSocket.on("whatsapp-message-new", (data: { jid: string; message: Message }) => {
      console.log("Received real-time message:", data);
      
      const isMe = data.message.sender === "me";

      if (!isMe) {
        playReceivedSound();
        const existing = contacts.find((c) => c.id === data.jid);
        const senderName = existing?.name || getFallbackContactName(data.jid);
        triggerDesktopNotification(senderName, data.message.text);
      }

      setChats((prev) => {
        const current = prev[data.jid] || [];
        if (current.some((m) => m.id === data.message.id)) return prev;

        // If sent by me, search for a temporary client-side message to replace (avoids duplicate items)
        if (isMe) {
          let tempIndex = -1;
          for (let i = current.length - 1; i >= 0; i--) {
            const m = current[i];
            if (m.id.startsWith("msg_") && m.sender === "me" && m.type === data.message.type) {
              if (m.type === "text") {
                if (m.text === data.message.text) {
                  tempIndex = i;
                  break;
                }
              } else {
                // For files, audio, video, images, match the latest temporary message of that type
                tempIndex = i;
                break;
              }
            }
          }

          if (tempIndex !== -1) {
            console.log("Replacing temporary local message with live synced WhatsApp message:", data.message.id);
            const updated = [...current];
            updated[tempIndex] = {
              ...data.message,
              // Keep local fileUrl / blob URL if the incoming live one is fallback/placeholder
              fileUrl: (data.message.fileUrl && !data.message.fileUrl.includes("unsplash.com")) 
                ? data.message.fileUrl 
                : (updated[tempIndex].fileUrl || data.message.fileUrl),
            };
            return {
              ...prev,
              [data.jid]: updated,
            };
          }
        }

        return {
          ...prev,
          [data.jid]: [...current, data.message],
        };
      });

      setContacts((prev) => {
        const nowSec = Math.floor(Date.now() / 1000);
        const exists = prev.some((c) => c.id === data.jid);
        if (!exists) {
          const isGrp = data.jid.endsWith("@g.us");
          const newContact: Contact = {
            id: data.jid,
            name: getFallbackContactName(data.jid),
            avatar: "",
            isGroup: isGrp,
            unreadCount: 1,
            about: isGrp ? "WhatsApp Group" : "Hey there! I am using WhatsApp.",
            status: "online",
            phoneNumber: isGrp ? undefined : (data.jid.includes("@s.whatsapp.net") ? formatPhoneNumber(data.jid.split("@")[0]) : undefined),
            conversationTimestamp: nowSec,
            lastActivityTimestamp: nowSec,
          };
          return [newContact, ...prev];
        }

        return prev.map((c) => {
          if (c.id === data.jid) {
            const currentActiveId = activeContactIdRef.current;
            return {
              ...c,
              unreadCount: currentActiveId === data.jid ? 0 : c.unreadCount + 1,
              status: "online" as const,
              conversationTimestamp: nowSec,
              lastActivityTimestamp: nowSec,
            };
          }
          return c;
        });
      });
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Dispatch browser desktop notifications
  const triggerDesktopNotification = (senderName: string, bodyText: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(senderName, {
          body: bodyText,
          icon: "https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png",
        });
      } catch (err) {
        console.warn("Desktop notification skipped inside sandboxed iframe restrictions.");
      }
    }
  };

  // Sound and timing helpers
  const getCurrentFormattedTime = () => {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutesStr = minutes < 10 ? "0" + minutes : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
  };

  // Main Message Send Handler
  const handleSendMessage = (
    text: string,
    type: "text" | "image" | "voice" | "file" | "video" | "sticker" | "contact" | "location" | "poll" = "text",
    fileData?: { name: string; size: string; url: string },
    contactCard?: { name: string; phone: string; avatar?: string; about?: string },
    locationData?: { latitude: number; longitude: number; name: string; address?: string },
    pollData?: { question: string; options: { id: string; text: string; votes: string[] }[] }
  ) => {
    if (!activeContactId) return;

    // Check if blocked first
    const currentContact = contacts.find((c) => c.id === activeContactId);
    if (currentContact?.isBlocked) {
      alert("This contact is blocked. Unblock them first inside the group details sidebar!");
      return;
    }

    playSentSound();

    const newMessageId = `msg_${Date.now()}`;
    const newMessage: Message = {
      id: newMessageId,
      sender: "me",
      text: type === "text" ? text : `Shared ${type}: ${fileData?.name || text}`,
      timestamp: getCurrentFormattedTime(),
      type,
      status: "sent",
      fileName: fileData?.name,
      fileSize: fileData?.size,
      fileUrl: fileData?.url,
      contactCard,
      locationData,
      pollData,
      replyTo: quotedMessage
        ? {
            messageId: quotedMessage.id,
            text: quotedMessage.text,
            sender: quotedMessage.sender,
          }
        : undefined,
    };

    // Update chats list
    setChats((prev) => {
      const currentMessages = prev[activeContactId] || [];
      return {
        ...prev,
        [activeContactId]: [...currentMessages, newMessage],
      };
    });

    // Clear quoted text indicator
    setQuotedMessage(null);

    // Send real-time WhatsApp message if connected
    if (whatsappStatus === "connected" && socket) {
      if (type === "text") {
        socket.emit("action:send-text", {
          to: activeContactId,
          text,
        });
      } else if ((type === "image" || type === "voice" || type === "file") && fileData?.url) {
        fetch(fileData.url)
          .then((res) => res.blob())
          .then((blob) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result as string;
              socket.emit("action:send-media", {
                to: activeContactId,
                base64Data: base64,
                type: type,
                mimeType: blob.type,
              });
            };
            reader.readAsDataURL(blob);
          })
          .catch((err) => console.error("Error converting file to base64 for WhatsApp delivery:", err));
      }
    }

    // Mark delivery ticks simulation
    setTimeout(() => {
      setChats((prev) => {
        const messages = prev[activeContactId] || [];
        return {
          ...prev,
          [activeContactId]: messages.map((m) =>
            m.id === newMessage.id ? { ...m, status: "delivered" as const } : m
          ),
        };
      });
    }, 1000);

    // Simulated responses (only for mock contacts, not real WhatsApp contacts)
    if (!isRealContact(activeContactId)) {
      if (type === "poll") {
        if (currentContact?.isGroup) {
          setTimeout(() => {
            simulateGroupPollVotes(activeContactId, newMessageId);
          }, 3000);
        }
      } else {
        triggerContactResponse(activeContactId, text, type, fileData?.url);
      }
    }
  };

  // Simulates random group members voting on our newly created polls
  const simulateGroupPollVotes = (groupId: string, pollMsgId: string) => {
    setChats((prev) => {
      const groupMsgs = prev[groupId] || [];
      const updated = groupMsgs.map((m) => {
        if (m.id !== pollMsgId || !m.pollData) return m;

        // Choose random options to vote for from Mother, Father, or Brother
        const voters = ["Mother", "Father", "Brother"];
        const optionsCopy = m.pollData.options.map((opt, oIdx) => {
          const randVotes = [...opt.votes];
          // Assign Mother to option 1, Father to option 2, Brother to option 3 randomly
          if (oIdx === 0) randVotes.push("Brother");
          if (oIdx === 1) randVotes.push("Father");
          if (oIdx === 2) randVotes.push("Mother");
          return { ...opt, votes: Array.from(new Set(randVotes)) };
        });

        return {
          ...m,
          pollData: {
            ...m.pollData,
            options: optionsCopy,
          },
        };
      });

      return {
        ...prev,
        [groupId]: updated,
      };
    });

    playReceivedSound();
    triggerDesktopNotification("Family Group ❤️", "🗳️ New votes registered on your poll!");
  };

  // Simulates replies from contacts
  const triggerContactResponse = (
    contactId: string,
    userText: string,
    messageType: "text" | "image" | "voice" | "file" | "video" | "sticker" | "contact" | "location" | "poll",
    fileUrl?: string
  ) => {
    // Set status to typing...
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, status: "typing..." as const } : c))
    );

    if (contactId === "meta-ai") {
      handleMetaAiReply(userText, messageType, fileUrl);
    } else {
      setTimeout(() => {
        let replyText = "";
        let senderName = "";

        if (contactId === "zuck") {
          senderName = "Mark Zuckerberg";
          const zuckQuotes = [
            "This WhatsApp Web clone is extremely fast! Are you using the Vite + Tailwind build? Let me share this code with our web engineering leads! 🚀",
            "Great ideas! Keeping people connected securely is our highest priority. Let me know if you want to integrate this with our Quest and Ray-Ban smart glasses! 😎",
            "Awesome! Thanks for checking out the Multi-Device settings. See you in the Metaverse!",
          ];
          replyText = zuckQuotes[Math.floor(Math.random() * zuckQuotes.length)];
        } else if (contactId === "family-group") {
          senderName = "Family Group ❤️";
          const familyQuotes = [
            "Mother: খুব ভালো বাবা, আসার সময় একটু ধনেপাতা আর তরতাজা বেগুন নিয়ে আসিস তো! 🍆",
            "Father: সাবধানে ফিরবি রাস্তায় অনেক জ্যাম থাকতে পারে। সাবধানে ড্রাইভ করিস।",
            "Brother: ভাইয়া ফ্রিজ থেকে আমার কোকাকোলার ক্যানটা বের করে রাখিস প্লিজ! 🥤",
          ];
          replyText = familyQuotes[Math.floor(Math.random() * familyQuotes.length)];
        } else if (contactId === "jane-doe") {
          senderName = "Jane Doe";
          if (messageType === "image") {
            replyText = "Wow! This is a beautiful photograph. The color balance and details are perfect. Did you edit this yourself?";
          } else {
            replyText = "That sounds fantastic! Let's schedule our next travel photography workshop next Saturday at 10 AM.";
          }
        }

        if (replyText) {
          sendContactMessage(contactId, replyText, "text", senderName);
        }
      }, 3000);
    }
  };

  // Meta AI Gemini-Powered Responses
  const handleMetaAiReply = async (userText: string, type: string, fileUrl?: string) => {
    const endpoint = type === "image" ? "/api/chat/analyze" : "/api/chat/meta";
    const history = chats["meta-ai"] || [];

    try {
      let payload: any = {};
      if (type === "image") {
        payload = {
          image: fileUrl,
          mimeType: "image/png",
          prompt: "Describe this image in detail. Answer in Bengali or English based on context.",
        };
      } else {
        payload = {
          message: userText,
          history: history.map((m) => ({
            sender: m.sender,
            text: m.text,
            type: m.type,
          })),
        };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Backend connection failed");
      const data = await res.json();

      if (data.image) {
        // Image generation returned
        sendContactMessage("meta-ai", data.text, "image", "Meta AI", data.image);
      } else {
        sendContactMessage("meta-ai", data.text, "text", "Meta AI");
      }
    } catch (err) {
      console.error("Meta AI connection error, using fallback offline mode:", err);
      // Friendly fallback offline witty replies in Bengali / English
      setTimeout(() => {
        sendContactMessage(
          "meta-ai",
          "উফ! আমার সার্ভার সংযোগে একটু সমস্যা হয়েছে। তবে আপনি যা লিখেছেন তা আমি খুব মনোযোগ দিয়ে পড়েছি! আশা করি আপনার দিনটি শুভ হবে। 🍀",
          "text",
          "Meta AI"
        );
      }, 1500);
    }
  };

  // Helper to commit an incoming message from a contact
  const sendContactMessage = (
    contactId: string,
    text: string,
    type: "text" | "image" = "text",
    senderName: string,
    fileUrl?: string
  ) => {
    playReceivedSound();
    triggerDesktopNotification(senderName, type === "image" ? "📷 Sent an image" : text);

    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      sender: "them",
      text,
      timestamp: getCurrentFormattedTime(),
      type,
      status: "read",
      fileUrl,
      fileName: type === "image" ? "meta_ai_generated.png" : undefined,
    };

    setChats((prev) => {
      const current = prev[contactId] || [];
      return {
        ...prev,
        [contactId]: [...current, newMsg],
      };
    });

    // Reset status back to online/offline
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contactId
          ? {
              ...c,
              status: c.id === "zuck" ? "offline" : ("online" as const),
              unreadCount: activeContactId === contactId ? 0 : c.unreadCount + 1,
            }
          : c
      )
    );
  };

  // Handle Speech Transcription (Gemini-3.5-Flash)
  const handleTranscribeVoice = async (messageId: string) => {
    if (!activeContactId) return;

    const messageToTranscribe = chats[activeContactId]?.find((m) => m.id === messageId);
    if (!messageToTranscribe || !messageToTranscribe.fileUrl) return;

    // Set loading indicator
    setChats((prev) => {
      const msgs = prev[activeContactId] || [];
      return {
        ...prev,
        [activeContactId]: msgs.map((m) =>
          m.id === messageId ? { ...m, isTranscribing: true } : m
        ),
      };
    });

    try {
      // Convert Blob URL to base64 for server delivery
      const resBlob = await fetch(messageToTranscribe.fileUrl);
      const audioBlob = await resBlob.blob();

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;

        const res = await fetch("/api/chat/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio: base64Audio,
            mimeType: "audio/webm",
          }),
        });

        if (!res.ok) throw new Error("Transcription request failed");
        const data = await res.json();

        setChats((prev) => {
          const msgs = prev[activeContactId] || [];
          return {
            ...prev,
            [activeContactId]: msgs.map((m) =>
              m.id === messageId ? { ...m, isTranscribing: false, transcription: data.text } : m
            ),
          };
        });
      };
      reader.readAsDataURL(audioBlob);
    } catch (err) {
      console.error("Audio Transcription failed:", err);
      setChats((prev) => {
        const msgs = prev[activeContactId] || [];
        return {
          ...prev,
          [activeContactId]: msgs.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  isTranscribing: false,
                  transcription: "Could not transcribe this audio. Please check your network connection.",
                }
              : m
          ),
        };
      });
    }
  };

  // Handle Interactive Poll voting logic
  const handleUpdatePollVote = (msgId: string, optionId: string) => {
    if (!activeContactId) return;
    setChats((prev) => {
      const current = prev[activeContactId] || [];
      const updated = current.map((m) => {
        if (m.id !== msgId || !m.pollData) return m;

        const newOptions = m.pollData.options.map((opt) => {
          if (opt.id === optionId) {
            const hasVoted = opt.votes.includes("You (Owner)");
            const newVotes = hasVoted
              ? opt.votes.filter((v) => v !== "You (Owner)")
              : [...opt.votes, "You (Owner)"];
            return { ...opt, votes: newVotes };
          }
          return opt;
        });

        return {
          ...m,
          pollData: {
            ...m.pollData,
            options: newOptions,
          },
        };
      });

      return {
        ...prev,
        [activeContactId]: updated,
      };
    });
  };

  // Handle message reactions toggle
  const handleAddReaction = (msgId: string, emoji: string) => {
    if (!activeContactId) return;
    setChats((prev) => {
      const current = prev[activeContactId] || [];
      const updated = current.map((m) => {
        if (m.id !== msgId) return m;

        const currentReactions = m.reactions || [];
        const alreadyHas = currentReactions.some((r) => r.sender === "me" && r.emoji === emoji);

        let newReactions = [];
        if (alreadyHas) {
          // Toggle off
          newReactions = currentReactions.filter((r) => !(r.sender === "me" && r.emoji === emoji));
        } else {
          // Remove previous my reaction, then append
          newReactions = [
            ...currentReactions.filter((r) => r.sender !== "me"),
            { emoji, sender: "me" as const },
          ];
        }

        return {
          ...m,
          reactions: newReactions,
        };
      });

      return {
        ...prev,
        [activeContactId]: updated,
      };
    });
  };

  const handleArchiveContact = (contactId: string, archiveState: boolean) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, archive: archiveState } : c))
    );
    if (whatsappStatus === "connected" && socket) {
      socket.emit("action:archive-chat", { jid: contactId, archiveState });
    }
  };

  // Set contact/group properties (such as Mute, Block, description updates, etc.)
  const handleUpdateContactSettings = (contactId: string, updates: Partial<Contact>) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, ...updates } : c))
    );
  };

  const handleClearChat = (contactId: string) => {
    setChats((prev) => ({
      ...prev,
      [contactId]: [],
    }));
  };

  const handleDeleteChat = (contactId: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    setChats((prev) => {
      const updated = { ...prev };
      delete updated[contactId];
      return updated;
    });
    if (activeContactId === contactId) {
      setActiveContactId(null);
    }
  };

  const handleAddNewContact = (name: string, phoneNumber: string) => {
    const isGroup = phoneNumber.startsWith("GROUP_CREATION_MARKER");
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
    const contactId = isGroup
      ? `group_${Date.now()}@g.us`
      : (cleanPhone ? `${cleanPhone}@s.whatsapp.net` : `contact_${Date.now()}`);
    
    // Check if contact already exists
    const existing = contacts.find((c) => c.id === contactId || (!isGroup && c.phoneNumber === phoneNumber));
    if (existing) {
      handleSelectContact(existing.id);
      return;
    }

    const newContact: Contact = {
      id: contactId,
      name: name,
      avatar: "",
      isGroup: isGroup,
      unreadCount: 0,
      about: isGroup ? "Group Chat" : "Hey there! I am using WhatsApp.",
      status: "online",
      phoneNumber: isGroup ? undefined : phoneNumber,
      groupDescription: isGroup ? `Welcome to "${name}"! Group established successfully.` : undefined,
      participants: isGroup
        ? [{ id: "me", name: "You (Owner)", role: "admin" }]
        : undefined,
    };

    setContacts((prev) => [newContact, ...prev]);
    setChats((prev) => ({
      ...prev,
      [contactId]: [],
    }));

    handleSelectContact(contactId);
  };

  const handleViewProfile = (id: string) => {
    handleSelectContact(id);
    setViewingContactProfileId(id);
  };

  const handleSelectContact = (id: string | null) => {
    try {
      console.log("handleSelectContact called with ID:", id);
      setActiveContactId(id);
      setIsSearchOpen(false);
      setQuotedMessage(null);
      setViewingContactProfileId(null);

      if (!id) {
        console.log("Cleared active contact ID");
        return;
      }

      // Reset unread count for the active chat
      setContacts((prev) => {
        try {
          return prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c));
        } catch (e) {
          console.error("Error updating unread count in contacts:", e);
          return prev;
        }
      });

      // Set all sent messages as read
      setChats((prev) => {
        try {
          const current = prev[id] || [];
          return {
            ...prev,
            [id]: current.map((m) => (m.sender === "me" ? { ...m, status: "read" as const } : m)),
          };
        } catch (e) {
          console.error("Error marking messages as read in chats:", e);
          return prev;
        }
      });

      // 1. If chat messages not in memory yet, load from IndexedDB immediately so UI shows existing chat instantly
      if (!chats[id] || chats[id].length === 0) {
        loadChatHistory(id).then((saved) => {
          if (saved && saved.length > 0) {
            setChats((prev) => ({
              ...prev,
              [id]: saved,
            }));
          }
        });
      }

      // 2. Emit live on-demand 3-month history sync specifically for this target contact!
      if (whatsappStatus === "connected" && socket) {
        try {
          socket.emit("action:sync-target-chat", { jid: id, count: 200 });
          socket.emit("action:seen-chat", id);
        } catch (e) {
          console.error("Error emitting on-demand target sync socket action:", e);
        }
      }
    } catch (globalError) {
      console.error("CRITICAL error in handleSelectContact:", globalError);
      alert("Error opening chat: " + (globalError as Error).message);
    }
  };

  const handleReloadChatHistory = (contactId: string, count = 200) => {
    if (socket) {
      console.log("Emitting on-demand sync / reload for contact ID:", contactId, "count:", count);
      socket.emit("action:sync-target-chat", { jid: contactId, count });
    } else {
      console.warn("Socket not initialized, cannot reload history");
    }
  };

  // Join a group by parsed invite link or search code
  const handleJoinGroupByInvite = (groupName: string, inviteUrl: string) => {
    const groupId = `group_${Date.now()}`;
    const newGroup: Contact = {
      id: groupId,
      name: groupName,
      avatar: "",
      isGroup: true,
      unreadCount: 0,
      about: "Joined via link invite",
      status: "online",
      groupDescription: `Welcome to ${groupName}! This group was joined via the invite link: ${inviteUrl}`,
      inviteLink: inviteUrl,
      participants: [
        { id: "me", name: "You (Owner)", role: "member" },
        { id: "admin_p", name: "Group Admin Creator", role: "admin" },
      ],
    };

    setContacts((prev) => [newGroup, ...prev]);
    setChats((prev) => ({
      ...prev,
      [groupId]: [
        {
          id: `msg_join_${Date.now()}`,
          sender: "them",
          text: `You joined this group using an invite link. Say hi! 👋`,
          timestamp: getCurrentFormattedTime(),
          type: "text",
          status: "read",
        },
      ],
    }));

    handleSelectContact(groupId);
    alert(`Successfully joined "${groupName}" via invite link!`);
  };

  const activeContact = contacts.find((c) => c.id === activeContactId) || null;
  const activeMessages = activeContactId ? chats[activeContactId] || [] : [];

  // Get last messages of each contact for sidebar summary (fallback to preloaded contact.lastMessage)
  const lastMessagesMap = contacts.reduce<Record<string, Message | undefined>>((acc, contact) => {
    const msgs = chats[contact.id] || [];
    acc[contact.id] = (msgs && msgs.length > 0) ? msgs[msgs.length - 1] : contact.lastMessage;
    return acc;
  }, {});

  const handleStartPairing = (phone?: string) => {
    if (socket) {
      setWhatsappError(null);
      setWhatsappStatus("connecting");
      socket.emit("start-pairing", { phoneNumber: phone });
    }
  };

  const handleDisconnectWhatsapp = () => {
    if (socket) {
      socket.emit("disconnect-whatsapp");
    }
  };

  return (
    <div
      className={`w-screen h-screen flex overflow-hidden font-sans select-none transition-all duration-300 ${
        isDark ? "bg-[#0b141a]" : "bg-[#dadbd3]"
      }`}
    >
      <div className="w-full h-full max-w-7xl mx-auto flex overflow-hidden shadow-2xl relative">
        {/* Left Hand Sidebar List */}
        <Sidebar
          contacts={contacts}
          lastMessages={lastMessagesMap}
          activeContactId={activeContactId}
          onSelectContact={handleSelectContact}
          onViewProfile={(contactId) => {
            setActiveContactId(contactId);
            setViewingContactProfileId(contactId);
          }}
          onArchiveContact={handleArchiveContact}
          isDark={isDark}
          onToggleTheme={() => setIsDark(!isDark)}
          onOpenProfile={() => setIsProfileOpen(true)}
          userProfile={userProfile}
          onJoinGroupByInvite={handleJoinGroupByInvite}
          whatsappStatus={whatsappStatus}
          qrCodeData={qrCodeData}
          pairingCode={pairingCode}
          connectedUser={connectedUser}
          whatsappError={whatsappError}
          onStartPairing={handleStartPairing}
          onDisconnectWhatsapp={handleDisconnectWhatsapp}
          onAddNewContact={handleAddNewContact}
          onUpdateContactSettings={handleUpdateContactSettings}
          onClearChat={handleClearChat}
          onDeleteChat={handleDeleteChat}
          isSocketConnected={isSocketConnected}
          activeServerUrl={activeServerUrl}
          onUpdateServerUrl={handleUpdateServerUrl}
        />

        {/* Right Hand Conversation / Intro Canvas */}
        <AnimatePresence mode="wait">
          {activeContact ? (
            <motion.div
              key={activeContact.id}
              initial={{ opacity: 0, x: 15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex"
            >
              {viewingContactProfileId === activeContact.id ? (
                <ContactInfoView
                  contact={activeContact}
                  messages={activeMessages}
                  isDark={isDark}
                  onClose={() => setViewingContactProfileId(null)}
                  onUpdateContactSettings={handleUpdateContactSettings}
                  onClearChat={handleClearChat}
                  onDeleteChat={handleDeleteChat}
                  onSearchClick={() => {
                    setViewingContactProfileId(null);
                    setIsSearchOpen(true);
                  }}
                />
              ) : (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  <ChatPane
                    contact={activeContact}
                    messages={activeMessages}
                    isDark={isDark}
                    batteryStatus={batteryStatus}
                    onSendMessage={handleSendMessage}
                    onTranscribe={handleTranscribeVoice}
                    onOpenSearch={() => setIsSearchOpen(!isSearchOpen)}
                    scrollToMessageId={scrollToMessageId}
                    clearScrollToMessage={() => setScrollToMessageId(null)}
                    onViewProfile={(contactId) => setViewingContactProfileId(contactId)}
                    onSetQuotedMessage={(msg) => setQuotedMessage(msg)}
                    onUpdatePollVote={handleUpdatePollVote}
                    onAddReaction={handleAddReaction}
                    onUpdateContactSettings={handleUpdateContactSettings}
                    onSelectContactById={handleSelectContact}
                    onReloadHistory={handleReloadChatHistory}
                  />
                  
                  {/* Typing panel drawer */}
                  <MessageInput
                    onSendMessage={handleSendMessage}
                    isDark={isDark}
                    contactId={activeContact.id}
                    contacts={contacts}
                    quotedMessage={quotedMessage}
                    onClearQuotedMessage={() => setQuotedMessage(null)}
                  />
                </div>
              )}

              {/* Collapsible Chat Search Drawer */}
              {isSearchOpen && !viewingContactProfileId && (
                <ChatSearch
                  messages={activeMessages}
                  onClose={() => setIsSearchOpen(false)}
                  isDark={isDark}
                  onScrollToMessage={(msgId) => setScrollToMessageId(msgId)}
                />
              )}
            </motion.div>
          ) : (
            <div className="hidden md:flex flex-1">
              <IntroScreen isDark={isDark} />
            </div>
          )}
        </AnimatePresence>

        {/* Collapsible Profile Settings Modal */}
        {isProfileOpen && (
          <ProfileModal
            profile={userProfile}
            onUpdate={setUserProfile}
            onClose={() => setIsProfileOpen(false)}
            isDark={isDark}
          />
        )}
      </div>
    </div>
  );
}
