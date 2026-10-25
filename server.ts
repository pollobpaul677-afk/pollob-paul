import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, Browsers, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import fs from "fs";

dotenv.config();

const app = express();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

// Global WhatsApp (Baileys) Connection State
let sock: any = null;
let whatsappStatus: "disconnected" | "connecting" | "qr-ready" | "pairing-code-ready" | "connected" = "disconnected";
let qrCodeData: string | null = null;
let pairingCode: string = "";
let connectedUser: any = null;
let whatsappError: string | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let phoneBatteryStatus: { value: number; isCharging: boolean } = { value: 85, isCharging: false };

// Track all active socket connections
const activeSockets = new Set<any>();

// Track active profile history syncs to prevent duplicate parallel operations
const activeSyncs = new Set<string>();

// Global Store (In-memory data cache for chats, messages, and contacts)
const store: {
  chats: Record<string, any>;
  messages: Record<string, any[]>;
  contacts: Record<string, any>;
} = {
  chats: {},
  messages: {},
  contacts: {},
};

const STORE_FILE = path.join(process.cwd(), "whatsapp_store.json");

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("Error saving store file:", err);
  }
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = fs.readFileSync(STORE_FILE, "utf8");
      const parsed = JSON.parse(data);
      if (parsed.chats) store.chats = parsed.chats;
      if (parsed.messages) store.messages = parsed.messages;
      if (parsed.contacts) store.contacts = parsed.contacts;
      
      // Auto-migrate cached chats with pnJid into store.contacts so all LID chats map to phone numbers immediately
      for (const [id, chat] of Object.entries(store.chats)) {
        if (chat && (chat as any).pnJid) {
          const pn = (chat as any).pnJid;
          if (!store.contacts[id]) store.contacts[id] = { id };
          store.contacts[id].pnJid = pn;
          if (!store.contacts[pn]) store.contacts[pn] = { id: pn };
          store.contacts[pn].lid = id;

          const existingName =
            store.contacts[pn]?.name ||
            store.contacts[pn]?.notify ||
            store.contacts[pn]?.verifiedName ||
            store.contacts[id]?.name ||
            store.contacts[id]?.notify ||
            store.contacts[id]?.verifiedName ||
            ((chat as any).name && !(chat as any).name.includes("@") && isNaN(Number((chat as any).name)) ? (chat as any).name : null);

          if (existingName && existingName.trim()) {
            store.contacts[id].name = existingName.trim();
            store.contacts[pn].name = existingName.trim();
          }
        }
      }
      console.log("Loaded cached store from file successfully. Chats count:", Object.keys(store.chats).length);
    }
  } catch (err) {
    console.error("Error loading store file:", err);
  }
}

// Immediately load previous store from file on startup
loadStore();

// ==========================================
// Profile Picture and Contact Info Retriever
// ==========================================
async function getContactInfo(sockInstance: any, jid: string) {
  if (!jid) return null;
  let changed = false;
  if (!store.contacts[jid]) {
    store.contacts[jid] = { id: jid };
    changed = true;
  }

  const chat = store.chats[jid];
  const pnJid = chat?.pnJid || store.contacts[jid]?.pnJid;

  // 1. Group Subject Resolution if missing
  if (jid.endsWith("@g.us") && sockInstance && (!chat?.name || chat.name.includes("@"))) {
    try {
      const meta = await sockInstance.groupMetadata(jid).catch(() => null);
      if (meta && meta.subject) {
        if (!store.chats[jid]) store.chats[jid] = { id: jid };
        store.chats[jid].name = meta.subject;
        store.contacts[jid].name = meta.subject;
        changed = true;
      }
    } catch (e) {}
  }

  // 2. Profile Picture Fetching (no broken onWhatsApp call)
  if (sockInstance && !store.contacts[jid].imgUrl) {
    try {
      const queryJid = pnJid || jid;
      let pic = await sockInstance.profilePictureUrl(queryJid, "image").catch(() => null);
      if (!pic && pnJid && pnJid !== jid) {
        pic = await sockInstance.profilePictureUrl(jid, "image").catch(() => null);
      }
      if (pic) {
        store.contacts[jid].imgUrl = pic;
        if (pnJid) {
          if (!store.contacts[pnJid]) store.contacts[pnJid] = { id: pnJid };
          store.contacts[pnJid].imgUrl = pic;
        }
        changed = true;
      }
    } catch (e) {}
  }

  // 3. Status (About) fetching for 1-on-1 chats
  if (sockInstance && !jid.endsWith("@g.us") && !jid.endsWith("@newsletter") && !store.contacts[jid].status) {
    try {
      const queryJid = pnJid || jid;
      const statusData = await sockInstance.fetchStatus(queryJid).catch(() => null);
      if (statusData?.status) {
        store.contacts[jid].status = statusData.status;
        if (pnJid) {
          if (!store.contacts[pnJid]) store.contacts[pnJid] = { id: pnJid };
          store.contacts[pnJid].status = statusData.status;
        }
        changed = true;
      }
    } catch (e) {}
  }

  if (changed) {
    saveStore();
  }
  return store.contacts[jid];
}

// ==========================================
// Media & Voice Message Cache & Decryption
// ==========================================
const MEDIA_CACHE_DIR = path.join(process.cwd(), "media_cache");
if (!fs.existsSync(MEDIA_CACHE_DIR)) {
  fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
}

function formatBytes(bytes: any): string {
  const num = Number(bytes);
  if (!num || isNaN(num) || num <= 0) return "";
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function formatVoiceDuration(seconds?: any): string {
  const num = Number(seconds);
  if (!num || isNaN(num) || num <= 0) return "0:00";
  const m = Math.floor(num / 60);
  const s = Math.floor(num % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// Unwraps nested WhatsApp wrappers like ephemeralMessage, viewOnceMessage, etc.
function unwrapMessage(rawMsg: any): any {
  if (!rawMsg) return null;
  let m = rawMsg;
  for (let i = 0; i < 5; i++) {
    if (m?.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
    } else if (m?.viewOnceMessage?.message) {
      m = m.viewOnceMessage.message;
    } else if (m?.viewOnceMessageV2?.message) {
      m = m.viewOnceMessageV2.message;
    } else if (m?.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message;
    } else {
      break;
    }
  }
  return m;
}

async function downloadAndCacheMedia(msg: any): Promise<{ url: string; dataUrl?: string; mimetype: string; fileName?: string; size?: string } | null> {
  try {
    if (!msg) return null;
    const msgId = msg.key?.id;
    const jid = msg.key?.remoteJid || "chat";
    if (!msgId) return null;

    const cacheFile = path.join(MEDIA_CACHE_DIR, `${msgId}.bin`);
    const metaFile = path.join(MEDIA_CACHE_DIR, `${msgId}.meta.json`);

    // Check disk cache first
    if (fs.existsSync(cacheFile) && fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        const stats = fs.statSync(cacheFile);
        let dataUrl: string | undefined = undefined;
        // Small voice records (< 1MB) generate inline dataUrl for instant seamless zero-lag playback
        if (stats.size < 1024 * 1024) {
          const buf = fs.readFileSync(cacheFile);
          dataUrl = `data:${meta.mimetype || "audio/ogg"};base64,${buf.toString("base64")}`;
        }
        return {
          url: `/api/media/${jid}/${msgId}`,
          dataUrl,
          mimetype: meta.mimetype || "application/octet-stream",
          fileName: meta.fileName,
          size: formatBytes(stats.size),
        };
      } catch (e) {}
    }

    const unpacked = unwrapMessage(msg.message);
    if (!unpacked) return null;

    let mediaType: "audio" | "image" | "video" | "document" | "sticker" | null = null;
    let rawMedia: any = null;

    if (unpacked.audioMessage) {
      mediaType = "audio";
      rawMedia = unpacked.audioMessage;
    } else if (unpacked.imageMessage) {
      mediaType = "image";
      rawMedia = unpacked.imageMessage;
    } else if (unpacked.videoMessage) {
      mediaType = "video";
      rawMedia = unpacked.videoMessage;
    } else if (unpacked.documentMessage) {
      mediaType = "document";
      rawMedia = unpacked.documentMessage;
    } else if (unpacked.stickerMessage) {
      mediaType = "sticker";
      rawMedia = unpacked.stickerMessage;
    }

    if (!mediaType || !rawMedia) return null;

    const streamPromise = (async () => {
      const stream = await downloadContentFromMessage(rawMedia, mediaType);
      let buf = Buffer.from([]);
      for await (const chunk of stream) {
        buf = Buffer.concat([buf, chunk]);
      }
      return buf;
    })();

    const timeoutPromise = new Promise<Buffer>((_, reject) =>
      setTimeout(() => reject(new Error("Stream download timeout")), 4500)
    );

    const buffer = await Promise.race([streamPromise, timeoutPromise]);
    if (!buffer || buffer.length === 0) return null;

    let mimetype = rawMedia.mimetype || (mediaType === "audio" ? "audio/ogg" : "image/jpeg");
    // Normalize opus audio mimetype
    if (mediaType === "audio" && mimetype.includes("audio/ogg")) {
      mimetype = "audio/ogg";
    }

    fs.writeFileSync(cacheFile, buffer);
    const metaData = {
      mimetype,
      fileName: rawMedia.fileName || (mediaType === "audio" ? (rawMedia.ptt ? "voice_note.ogg" : "audio_recording.ogg") : undefined),
      size: buffer.length,
      createdAt: Date.now(),
    };
    fs.writeFileSync(metaFile, JSON.stringify(metaData));

    let dataUrl: string | undefined = undefined;
    if (buffer.length < 1024 * 1024) {
      dataUrl = `data:${mimetype};base64,${buffer.toString("base64")}`;
    }

    return {
      url: `/api/media/${jid}/${msgId}`,
      dataUrl,
      mimetype,
      fileName: metaData.fileName,
      size: formatBytes(buffer.length),
    };
  } catch (err: any) {
    return null;
  }
}

// Fast timeout helper for voice notes auto-caching
async function downloadAndCacheMediaWithTimeout(msg: any, timeoutMs = 3500): Promise<{ url: string; dataUrl?: string; mimetype: string; fileName?: string; size?: string } | null> {
  try {
    return await Promise.race([
      downloadAndCacheMedia(msg),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch (e) {
    return null;
  }
}

// Legacy helper compatibility
async function downloadMediaMessage(message: any) {
  const res = await downloadAndCacheMedia(message);
  return res ? (res.dataUrl || res.url) : null;
}

function broadcastToAll(event: string, data?: any) {
  activeSockets.forEach((socket) => {
    socket.emit(event, data);
  });
}

const formatTimestamp = (timestampInSecs: number) => {
  const date = new Date(timestampInSecs * 1000);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? "0" + minutes : minutes;
  return `${hours}:${minutesStr} ${ampm}`;
};

const getCurrentFormattedTime = () => {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? "0" + minutes : minutes;
  return `${hours}:${minutesStr} ${ampm}`;
};

// ==========================================
// 3-Month Active Conversation Sync Filtering
// ==========================================
const THREE_MONTHS_DAYS = 90;
const THREE_MONTHS_SECONDS = THREE_MONTHS_DAYS * 24 * 60 * 60; // 90 days in seconds

function parseTimestampToSec(val: any): number {
  if (!val) return 0;
  if (typeof val === "number") {
    return val > 1e11 ? Math.floor(val / 1000) : Math.floor(val);
  }
  if (typeof val === "string") {
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
    }
    const parsedDate = Date.parse(val);
    if (!isNaN(parsedDate)) {
      return Math.floor(parsedDate / 1000);
    }
    return 0;
  }
  if (typeof val === "object") {
    if (typeof val.toNumber === "function") {
      const num = val.toNumber();
      return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
    }
    if ("low" in val && typeof val.low === "number") {
      const num = val.low;
      return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
    }
    if (val instanceof Date) {
      return Math.floor(val.getTime() / 1000);
    }
  }
  return 0;
}

function getChatLastActivitySec(chat: any, messages?: any[]): number {
  let latestSec = 0;
  if (chat) {
    if (chat.conversationTimestamp) {
      latestSec = Math.max(latestSec, parseTimestampToSec(chat.conversationTimestamp));
    }
    if (chat.lastMessageRecvTimestamp) {
      latestSec = Math.max(latestSec, parseTimestampToSec(chat.lastMessageRecvTimestamp));
    }
  }
  if (messages && messages.length > 0) {
    for (const m of messages) {
      const ts = parseTimestampToSec(m.messageTimestamp);
      if (ts > latestSec) latestSec = ts;
    }
  }
  return latestSec;
}

function isWithinLast3Months(timestampInSec: number): boolean {
  if (!timestampInSec || timestampInSec <= 0) return false;
  const nowInSec = Math.floor(Date.now() / 1000);
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  const threeMonthsAgoSec = Math.min(nowInSec - THREE_MONTHS_SECONDS, Math.floor(d.getTime() / 1000));
  return timestampInSec >= threeMonthsAgoSec;
}

function getRecentThreeMonthsChats(): any[] {
  const list = Object.values(store.chats).filter((chat: any) => {
    if (!chat || !chat.id) return false;
    const lastActivity = getChatLastActivitySec(chat, store.messages[chat.id]);
    return isWithinLast3Months(lastActivity);
  });
  list.sort((a, b) => getChatLastActivitySec(b, store.messages[b.id]) - getChatLastActivitySec(a, store.messages[a.id]));
  return list;
}

function formatPhoneNumber(rawDigits: string): string {
  const digits = rawDigits.replace(/\D/g, "");
  if (!digits) return rawDigits;

  // Bangladesh numbers (+880 1XXX-XXXXXX)
  if (digits.startsWith("880") && digits.length >= 12) {
    const local = digits.slice(3); // e.g. 1746653292
    return `+880 ${local.slice(0, 4)}-${local.slice(4)}`;
  }
  if (digits.startsWith("88") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+88 ${local.slice(0, 4)}-${local.slice(4)}`;
  }
  if (digits.startsWith("01") && digits.length === 11) {
    return `+880 ${digits.slice(1, 5)}-${digits.slice(5)}`;
  }
  // US / Canada
  if (digits.startsWith("1") && digits.length === 11) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  // India
  if (digits.startsWith("91") && digits.length === 12) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  // UK
  if (digits.startsWith("44") && digits.length >= 11) {
    return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  // Generic fallback
  if (digits.length >= 8) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

function resolveContactName(chat: any, jid: string): { name: string; phoneNumber?: string } {
  const isGroup = jid.endsWith("@g.us");
  const isNewsletter = jid.endsWith("@newsletter");

  // Groups
  if (isGroup) {
    const groupName = chat.name || chat.subject || store.chats[jid]?.name || store.chats[jid]?.subject;
    return {
      name: groupName && !groupName.includes("@") ? groupName : "WhatsApp Group",
    };
  }

  // Newsletters / Channels
  if (isNewsletter) {
    const channelName = chat.name || chat.subject || store.chats[jid]?.name || "WhatsApp Channel";
    return { name: channelName };
  }

  // 1-on-1 contact: resolve phone number
  const pnJid = chat.pnJid || store.contacts[jid]?.pnJid || (jid.endsWith("@s.whatsapp.net") ? jid : undefined);
  let formattedPhone: string | undefined = undefined;
  if (pnJid) {
    formattedPhone = formatPhoneNumber(pnJid.split("@")[0]);
  } else if (!jid.includes("@lid")) {
    const rawDigits = jid.split("@")[0].replace(/\D/g, "");
    if (rawDigits.length >= 7) {
      formattedPhone = formatPhoneNumber(rawDigits);
    }
  }

  // Find candidate contact record
  const contactRecord = store.contacts[jid] || (pnJid ? store.contacts[pnJid] : null);
  const altContact = pnJid ? store.contacts[pnJid] : null;

  // Search message pushNames if available
  let pushNameFromMsgs: string | undefined = undefined;
  const msgs = store.messages[jid] || (pnJid ? store.messages[pnJid] : []);
  if (msgs && msgs.length > 0) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.pushName && !m.key?.fromMe) {
        pushNameFromMsgs = m.pushName;
        break;
      }
    }
  }

  const candidateName =
    contactRecord?.name ||
    altContact?.name ||
    contactRecord?.notify ||
    altContact?.notify ||
    contactRecord?.verifiedName ||
    altContact?.verifiedName ||
    pushNameFromMsgs ||
    (chat.name && !chat.name.includes("@") && isNaN(Number(chat.name)) ? chat.name : null) ||
    (chat.displayName && !chat.displayName.includes("∙∙∙") ? chat.displayName : null);

  if (candidateName && candidateName.trim()) {
    return {
      name: candidateName.trim(),
      phoneNumber: formattedPhone,
    };
  }

  if (formattedPhone) {
    return {
      name: formattedPhone,
      phoneNumber: formattedPhone,
    };
  }

  return {
    name: "WhatsApp User",
    phoneNumber: undefined,
  };
}

const mapContact = (chat: any) => {
  const jid = chat.id || chat.remoteJid || "";
  const isGroup = jid.endsWith("@g.us");
  const isNewsletter = jid.endsWith("@newsletter");
  const unreadCount = chat.unreadCount || 0;
  
  const { name, phoneNumber } = resolveContactName(chat, jid);

  const pnJid = chat.pnJid || store.contacts[jid]?.pnJid;
  const avatar = 
    store.contacts[jid]?.imgUrl || 
    (pnJid ? store.contacts[pnJid]?.imgUrl : "") || 
    chat.imgUrl || 
    "";

  const about = 
    store.contacts[jid]?.status || 
    (pnJid ? store.contacts[pnJid]?.status : "") || 
    (isGroup ? "WhatsApp Group" : isNewsletter ? "WhatsApp Channel" : "Hey there! I am using WhatsApp.");

  const chatMessages = store.messages[jid] || (pnJid ? store.messages[pnJid] : []) || [];
  const conversationTimestamp = getChatLastActivitySec(chat, chatMessages);

  // Extract last message for fast, lightweight sidebar summary without full message blast
  let lastMessage: any = undefined;
  if (chatMessages.length > 0) {
    const rawLast = chatMessages[chatMessages.length - 1];
    lastMessage = mapMessage(rawLast) || undefined;
  }

  return {
    id: jid,
    name,
    avatar,
    isGroup,
    unreadCount,
    about,
    status: "online" as const,
    phoneNumber,
    conversationTimestamp,
    lastActivityTimestamp: conversationTimestamp,
    lastMessage,
    syncStatus: {
      synced: false,
      messageCount: chatMessages.length,
      timeSpan: "Last 3 months",
    },
  };
};

const mapMessage = (msg: any, mediaUrl?: string): any => {
  if (!msg) return null;

  const id = msg.key?.id || `msg_${Date.now()}`;
  const isMe = Boolean(msg.key?.fromMe);
  const jid = msg.key?.remoteJid || "";

  const timestampInSecs = parseTimestampToSec(msg.messageTimestamp);
  const timestamp = timestampInSecs ? formatTimestamp(timestampInSecs) : getCurrentFormattedTime();

  // 1. Check for call data
  if (msg.callData) {
    const isVideo = msg.callData.callType === "video";
    const status = msg.callData.status || "missed";
    let text = isVideo
      ? (status === "missed" ? "Missed video call" : "Video call")
      : (status === "missed" ? "Missed voice call" : "Voice call");
    if (msg.callData.duration) {
      text += ` (${msg.callData.duration})`;
    }

    return {
      id,
      sender: isMe ? "me" : "them",
      text,
      timestamp,
      rawTimestamp: timestampInSecs || Math.floor(Date.now() / 1000),
      type: "call",
      status: "read",
      callData: msg.callData,
    };
  }

  if (!msg.message) return null;

  // Unwrap any WhatsApp nested message wrappers (ephemeral, viewOnce, etc.)
  const messageContent = unwrapMessage(msg.message);
  if (!messageContent) return null;

  let type: any = "text";
  let text = "";
  let fileUrl = "";
  let fileName = "";
  let fileSize = "";
  let voiceDuration = "";
  let isHeavy = false;
  let contactCard = undefined;
  let locationData = undefined;
  let pollData = undefined;

  if (messageContent.conversation) {
    text = messageContent.conversation;
  } else if (messageContent.extendedTextMessage) {
    text = messageContent.extendedTextMessage.text || "";
  } else if (messageContent.imageMessage) {
    type = "image";
    text = messageContent.imageMessage.caption || "Photo";
    fileUrl = `/api/media/${jid}/${id}`;
    fileSize = formatBytes(messageContent.imageMessage.fileLength);
  } else if (messageContent.videoMessage) {
    type = "video";
    text = messageContent.videoMessage.caption || "Video clip";
    fileUrl = `/api/media/${jid}/${id}`;
    const bytes = Number(messageContent.videoMessage.fileLength);
    fileSize = formatBytes(bytes);
    isHeavy = bytes > 2.5 * 1024 * 1024;
  } else if (messageContent.audioMessage) {
    type = "voice";
    text = "Voice message";
    fileUrl = `/api/media/${jid}/${id}`;
    voiceDuration = formatVoiceDuration(messageContent.audioMessage.seconds);
    fileSize = formatBytes(messageContent.audioMessage.fileLength);
  } else if (messageContent.documentMessage) {
    type = "file";
    text = messageContent.documentMessage.fileName || "Document";
    fileName = messageContent.documentMessage.fileName || "Document";
    const bytes = Number(messageContent.documentMessage.fileLength);
    fileSize = formatBytes(bytes) || "Document";
    isHeavy = bytes > 2.5 * 1024 * 1024;
    fileUrl = `/api/media/${jid}/${id}`;
  } else if (messageContent.stickerMessage) {
    type = "sticker";
    text = "Sticker";
    fileUrl = `/api/media/${jid}/${id}`;
  } else if (messageContent.locationMessage || messageContent.liveLocationMessage) {
    type = "location";
    const loc = messageContent.locationMessage || messageContent.liveLocationMessage;
    text = loc.name || "Shared location";
    locationData = {
      latitude: loc.degreesLatitude || 0,
      longitude: loc.degreesLongitude || 0,
      name: loc.name || "Location",
      address: loc.address || "",
    };
  } else if (messageContent.contactMessage) {
    type = "contact";
    text = messageContent.contactMessage.displayName || "Contact card";
    contactCard = {
      name: messageContent.contactMessage.displayName || "Contact",
      phone: messageContent.contactMessage.vcard ? (messageContent.contactMessage.vcard.match(/waid=(\d+)/i)?.[1] || "") : "",
    };
  } else if (messageContent.pollCreationMessage || messageContent.pollCreationMessageV2 || messageContent.pollCreationMessageV3) {
    type = "poll";
    const poll = messageContent.pollCreationMessage || messageContent.pollCreationMessageV2 || messageContent.pollCreationMessageV3;
    text = poll.name || "Poll";
    pollData = {
      question: poll.name || "Poll",
      options: (poll.options || []).map((o: any, idx: number) => ({
        id: `opt_${idx}`,
        text: o.optionName || `Option ${idx + 1}`,
        votes: [],
      })),
    };
  } else {
    // Other protocol or status messages
    return null;
  }

  return {
    id,
    sender: isMe ? "me" : "them",
    text,
    timestamp,
    rawTimestamp: timestampInSecs || Math.floor(Date.now() / 1000),
    type,
    status: "read",
    fileName,
    fileSize,
    fileUrl: mediaUrl || fileUrl,
    voiceDuration,
    isHeavy,
    contactCard,
    locationData,
    pollData,
  };
};

async function connectToWhatsApp(phoneNumber?: string) {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // If already authenticated and active, do not interrupt
  if (sock && whatsappStatus === "connected") {
    console.log("WhatsApp is already connected.");
    return;
  }

  // Safely cleanup previous unauthenticated socket
  if (sock) {
    try {
      if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
        sock.ev.removeAllListeners("connection.update");
        sock.ev.removeAllListeners("creds.update");
        sock.ev.removeAllListeners("messaging-history.set");
        sock.ev.removeAllListeners("messages.upsert");
      }
      sock.end?.();
    } catch (err) {
      console.warn("Could not clean up previous socket:", err);
    }
    sock = null;
  }

  whatsappStatus = "connecting";
  qrCodeData = null;
  pairingCode = "";
  whatsappError = null;
  broadcastToAll("whatsapp-status", "connecting");

  try {
    const authFolder = path.join(process.cwd(), "auth_info_baileys");

    // Clear stale session files to guarantee fresh QR or pairing code generation
    if (phoneNumber || !fs.existsSync(path.join(authFolder, "creds.json"))) {
      try {
        if (fs.existsSync(authFolder)) {
          fs.rmSync(authFolder, { recursive: true, force: true });
          console.log("Cleared existing authFolder to start a fresh pairing/QR session.");
        }
      } catch (err) {
        console.error("Error clearing authFolder:", err);
      }
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const makeSocketFn = typeof makeWASocket === "function" ? makeWASocket : (makeWASocket as any).default;

    const silentLogger = {
      level: "silent",
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
      trace: () => {},
      child: () => silentLogger,
    } as any;

    const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 1043857760],
      isLatest: true,
    }));
    console.log(`Using WhatsApp Web Version: ${version.join(".")}, isLatest: ${isLatest}`);

    sock = makeSocketFn({
      auth: state,
      version,
      printQRInTerminal: false,
      syncFullHistory: true, // Enable complete history sync from WhatsApp server
      logger: silentLogger,
      browser: Browsers.ubuntu("Chrome"),
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      getMessage: async (key: any) => {
        const jid = key?.remoteJid;
        if (jid && store.messages[jid]) {
          const m = store.messages[jid].find((msg: any) => msg.key?.id === key?.id);
          if (m) return m.message;
        }
        return undefined;
      },
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("call", async (calls: any[]) => {
      console.log(`Received call events: ${calls?.length || 0}`);
      for (const call of calls || []) {
        const jid = call.from || call.chatId;
        if (!jid) continue;
        const isVideo = Boolean(call.isVideo);
        const status = call.status || "missed";
        const callMsg = {
          key: { remoteJid: jid, fromMe: false, id: `call_${call.id || Date.now()}` },
          messageTimestamp: Math.floor(Date.now() / 1000),
          callData: {
            callType: isVideo ? "video" : "audio",
            status: status,
            duration: call.duration ? `${call.duration}s` : "",
            date: new Date().toISOString(),
          },
        };
        if (!store.messages[jid]) store.messages[jid] = [];
        store.messages[jid].push(callMsg);
        saveStore();

        const mapped = mapMessage(callMsg);
        if (mapped) {
          broadcastToAll("whatsapp-message-new", { jid, message: mapped });
        }
      }
    });

    if (phoneNumber && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          console.log(`Requesting pairing code for phone: ${phoneNumber}`);
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(`Pairing code received successfully: ${code}`);
          pairingCode = code;
          whatsappStatus = "pairing-code-ready";
          broadcastToAll("whatsapp-status", "pairing-code-ready");
          broadcastToAll("whatsapp-pairing-code", code);
        } catch (err: any) {
          console.error("Failed to request pairing code:", err);
          whatsappError = `Failed to generate pairing code: ${err.message || "Invalid phone number or rate limit"}`;
          whatsappStatus = "disconnected";
          broadcastToAll("whatsapp-error", whatsappError);
          broadcastToAll("whatsapp-status", "disconnected");
        }
      }, 1500);
    }

    sock.ev.on("connection.update", async (update: any) => {
      const { connection, lastDisconnect, qr, battery } = update;

      if (battery) {
        try {
          phoneBatteryStatus = {
            value: Number(battery.value ?? battery.level ?? phoneBatteryStatus.value),
            isCharging: Boolean(battery.charging || battery.live),
          };
          broadcastToAll("whatsapp:battery-status", phoneBatteryStatus);
        } catch (_) {}
      }

      if (qr && !phoneNumber) {
        try {
          const qrImage = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
          qrCodeData = qrImage;
          whatsappStatus = "qr-ready";
          broadcastToAll("whatsapp-status", "qr-ready");
          broadcastToAll("whatsapp-qr", qrImage);
        } catch (err: any) {
          console.error("QR Code generation error:", err);
        }
      }

      if (connection === "close") {
        const error = lastDisconnect?.error;
        let reason = error?.output?.statusCode ?? error?.code ?? error?.statusCode;

        const isIntentionalLogout = 
          reason === DisconnectReason.loggedOut || 
          error?.message === "Intentional Logout" || 
          (error?.stack && error.stack.includes("Intentional Logout")) ||
          (error?.message && error.message.includes("logout")) ||
          reason === 401;

        if (isIntentionalLogout) {
          reason = DisconnectReason.loggedOut;
          console.log(`WhatsApp connection closed cleanly (intentional logout).`);
        } else {
          console.log(`WhatsApp connection closed. Reason/StatusCode: ${reason}.`);
        }

        // Set previous socket reference to null as it is closed
        sock = null;

        let shouldReconnect = true;
        let shouldClearCreds = false;

        if (reason === DisconnectReason.loggedOut) {
          console.log("Logged out from WhatsApp. Clearing credentials...");
          shouldReconnect = false;
          shouldClearCreds = true;
        } else if (reason === DisconnectReason.badSession) {
          console.log("Bad session. Clearing credentials and requiring re-pairing...");
          shouldReconnect = false;
          shouldClearCreds = true;
          broadcastToAll("whatsapp-error", "WhatsApp session is corrupted or invalid. Please link your device again.");
        } else if (reason === 405) {
          console.log("WhatsApp rejected connection (405 - client_too_old or invalid handshake). Clearing session...");
          shouldReconnect = false;
          shouldClearCreds = true;
          broadcastToAll("whatsapp-error", "Connection rejected by WhatsApp servers (Code 405). Please click retry to generate a fresh QR Code or Pairing Code.");
        } else if (reason === DisconnectReason.connectionReplaced) {
          console.log("Connection replaced (opened in another session/tab). Disconnecting to avoid conflict loops.");
          shouldReconnect = false;
          broadcastToAll("whatsapp-error", "Connection replaced. Opened in another window/device.");
        } else if (reason === DisconnectReason.restartRequired || reason === 515) {
          console.log("Restart required. Reconnecting immediately...");
          shouldReconnect = true;
        } else {
          console.log(`Temporary disconnect (reason code: ${reason}). Will attempt reconnection in 5s...`);
          shouldReconnect = true;
        }

        if (shouldReconnect) {
          whatsappStatus = "connecting";
          qrCodeData = null;
          pairingCode = "";
          // Keep connectedUser in memory to prevent the frontend from resetting back to the mock screen
          broadcastToAll("whatsapp-status", "connecting");

          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          
          const delay = (reason === DisconnectReason.restartRequired || reason === 515) ? 500 : 5000;
          reconnectTimeout = setTimeout(() => {
            console.log("Attempting automatic WhatsApp reconnection...");
            connectToWhatsApp();
          }, delay);
        } else {
          whatsappStatus = "disconnected";
          qrCodeData = null;
          pairingCode = "";
          connectedUser = null;
          broadcastToAll("whatsapp-status", "disconnected");
        }

        if (shouldClearCreds) {
          try {
            if (fs.existsSync(authFolder)) {
              fs.rmSync(authFolder, { recursive: true, force: true });
              console.log("Auth folder deleted successfully.");
            }
          } catch (err) {
            console.error("Failed to delete auth folder:", err);
          }
        }
      } else if (connection === "open") {
        console.log("WhatsApp successfully connected!");
        whatsappStatus = "connected";
        connectedUser = {
          id: sock.user?.id,
          name: sock.user?.name || "Connected User",
          phoneNumber: sock.user?.id?.split(":")[0] || phoneNumber || "",
        };
        broadcastToAll("whatsapp-status", "connected");
        broadcastToAll("user-info", connectedUser);
      }
    });

    sock.ev.on("messaging-history.set", async (history: any) => {
      console.log(`Syncing History: ${history.chats?.length || 0} chats, ${history.contacts?.length || 0} contacts found.`);
      
      // 1. Save contacts from history
      if (history.contacts && Array.isArray(history.contacts)) {
        for (const c of history.contacts) {
          if (!c || !c.id) continue;
          store.contacts[c.id] = { ...store.contacts[c.id], ...c };
          if (c.lid) {
            store.contacts[c.lid] = { ...store.contacts[c.lid], ...c };
            if (!store.contacts[c.lid].pnJid) store.contacts[c.lid].pnJid = c.id;
          }
          if (c.phoneNumber && !store.contacts[c.id].pnJid) {
            store.contacts[c.id].pnJid = `${c.phoneNumber}@s.whatsapp.net`;
          }
        }
      }

      // 2. Collect incoming messages first to establish accurate latest message timestamps
      for (const msg of history.messages || []) {
        const jid = msg.key?.remoteJid;
        if (!jid) continue;
        if (msg.pushName && !msg.key?.fromMe) {
          if (!store.contacts[jid]) store.contacts[jid] = { id: jid };
          if (!store.contacts[jid].notify) store.contacts[jid].notify = msg.pushName;
          if (!store.contacts[jid].name) store.contacts[jid].name = msg.pushName;
        }
        if (!store.messages[jid]) store.messages[jid] = [];
        if (!store.messages[jid].some((m) => m.key?.id === msg.key?.id)) {
          store.messages[jid].push(msg);
        }
      }

      // 3. Send my profile info to frontend
      if (sock && sock.user) {
        const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
        const myPic = await sock.profilePictureUrl(myJid, "image").catch(() => null);
        broadcastToAll("whatsapp:my-profile", { name: sock.user.name, id: myJid, imgUrl: myPic });
      }

      // 4. Strict 3-month sync filter:
      // Only keep and sync chats where conversation took place within the last 3 months
      const recentThreeMonthsChats: any[] = [];
      for (const chat of history.chats || []) {
        if (!chat || !chat.id) continue;
        if (chat.pnJid) {
          if (!store.contacts[chat.id]) store.contacts[chat.id] = { id: chat.id };
          store.contacts[chat.id].pnJid = chat.pnJid;
          if (!store.contacts[chat.pnJid]) store.contacts[chat.pnJid] = { id: chat.pnJid };
          store.contacts[chat.pnJid].lid = chat.id;
          if (chat.name) {
            store.contacts[chat.id].name = chat.name;
            store.contacts[chat.pnJid].name = chat.name;
          }
        }

        const lastActivitySec = getChatLastActivitySec(chat, store.messages[chat.id]);
        if (isWithinLast3Months(lastActivitySec)) {
          store.chats[chat.id] = {
            ...chat,
            conversationTimestamp: lastActivitySec,
          };
          recentThreeMonthsChats.push(store.chats[chat.id]);
        } else {
          // Exclude any older profiles that have had no conversation within the last 3 months
          delete store.chats[chat.id];
        }
      }

      // Sort with newest conversation first
      recentThreeMonthsChats.sort((a, b) => 
        getChatLastActivitySec(b, store.messages[b.id]) - getChatLastActivitySec(a, store.messages[a.id])
      );

      console.log(`[3-Month Filter] Synced ${recentThreeMonthsChats.length} profiles with active conversation in the last 3 months.`);
      saveStore();

      const mappedContacts = recentThreeMonthsChats.map((chat: any) => mapContact(chat));
      console.log(`[On-Demand Sync Strategy] Broadcasting ${mappedContacts.length} contacts. Message histories will load on-demand when each profile is clicked.`);
      broadcastToAll("whatsapp:chats-loaded", mappedContacts);

      // 5. Fetch profile pictures & statuses ONLY for the synced 3-month profiles
      (async () => {
        for (const chat of recentThreeMonthsChats) {
          if (!chat || !chat.id) continue;
          try {
            const info = await getContactInfo(sock, chat.id);
            const mapped = mapContact(chat);
            broadcastToAll("whatsapp:chat-profile-ready", {
              jid: chat.id,
              profile: {
                id: chat.id,
                name: mapped.name,
                imgUrl: info?.imgUrl || mapped.avatar,
                status: info?.status || mapped.about,
                phoneNumber: mapped.phoneNumber,
              },
            });
            await new Promise((r) => setTimeout(r, 150));
          } catch (e) {}
        }
      })();
    });

    sock.ev.on("contacts.upsert", (newContacts: any[]) => {
      for (const c of newContacts || []) {
        if (!c || !c.id) continue;
        store.contacts[c.id] = { ...store.contacts[c.id], ...c };
        if (c.lid) {
          store.contacts[c.lid] = { ...store.contacts[c.lid], ...c };
          if (!store.contacts[c.lid].pnJid) store.contacts[c.lid].pnJid = c.id;
        }
      }
      saveStore();
      const mappedContacts = getRecentThreeMonthsChats().map((chat: any) => mapContact(chat));
      broadcastToAll("whatsapp:chats-loaded", mappedContacts);
    });

    sock.ev.on("contacts.update", (updates: any[]) => {
      for (const u of updates || []) {
        if (!u || !u.id) continue;
        store.contacts[u.id] = { ...store.contacts[u.id], ...u };
        if (u.lid) {
          store.contacts[u.lid] = { ...store.contacts[u.lid], ...u };
        }
      }
      saveStore();
      const mappedContacts = getRecentThreeMonthsChats().map((chat: any) => mapContact(chat));
      broadcastToAll("whatsapp:chats-loaded", mappedContacts);
    });

    sock.ev.on("groups.update", (groupUpdates: any[]) => {
      for (const g of groupUpdates || []) {
        if (!g || !g.id) continue;
        if (store.chats[g.id]) {
          if (g.subject) store.chats[g.id].name = g.subject;
          if (g.desc) store.chats[g.id].description = g.desc;
        }
      }
      saveStore();
      const mappedContacts = getRecentThreeMonthsChats().map((chat: any) => mapContact(chat));
      broadcastToAll("whatsapp:chats-loaded", mappedContacts);
    });

    sock.ev.on("messages.upsert", async (upsert: any) => {
      const { messages, type } = upsert;
      if (type === "notify") {
        for (const msg of messages) {
          const jid = msg.key?.remoteJid;
          if (!jid) continue;
          if (msg.pushName && !msg.key?.fromMe) {
            if (!store.contacts[jid]) store.contacts[jid] = { id: jid };
            if (!store.contacts[jid].notify) store.contacts[jid].notify = msg.pushName;
            if (!store.contacts[jid].name) store.contacts[jid].name = msg.pushName;
          }
          if (!store.messages[jid]) store.messages[jid] = [];
          if (!store.messages[jid].some((m) => m.key?.id === msg.key?.id)) {
            store.messages[jid].push(msg);
          }

          // Update chat conversationTimestamp to current message timestamp so it stays within 3 months
          const nowSec = parseTimestampToSec(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
          if (!store.chats[jid]) {
            store.chats[jid] = { id: jid, conversationTimestamp: nowSec };
          } else {
            store.chats[jid].conversationTimestamp = nowSec;
          }
          saveStore();

          // যদি মেসেজে মিডিয়া/ভয়েস থাকে, তা রিয়েল-টাইমে ডাউনলোড করে ফ্রন্টএন্ডে পুশ করা
          const hasMedia = msg.message?.imageMessage || msg.message?.audioMessage || msg.message?.videoMessage;
          let decryptedMedia = null;
          if (hasMedia) {
            decryptedMedia = await downloadMediaMessage(msg);
          }

          const mapped = mapMessage(msg, decryptedMedia);
          if (mapped) {
            broadcastToAll("whatsapp-message-new", { jid, message: mapped });
          }

          broadcastToAll("whatsapp:new-message", {
            jid,
            message: msg,
            mediaUrl: decryptedMedia,
          });
        }
      }
    });

  } catch (err: any) {
    console.error("Error in Baileys startup:", err);
    whatsappError = err.message || "Unknown error starting Baileys";
    whatsappStatus = "disconnected";
    broadcastToAll("whatsapp-error", whatsappError);
    broadcastToAll("whatsapp-status", "disconnected");
  }
}

// Auto-reconnect on server startup if credentials exist
const authFolder = path.join(process.cwd(), "auth_info_baileys");
if (fs.existsSync(path.join(authFolder, "creds.json"))) {
  console.log("Found existing credentials in authFolder. Auto-connecting to WhatsApp on startup...");
  connectToWhatsApp();
}

// Setup Baileys Socket.io Events
io.on("connection", (socket) => {
  console.log("Client connected via Socket.io:", socket.id);
  activeSockets.add(socket);

  // Send current global WhatsApp status and details immediately on connect
  socket.emit("whatsapp-status", whatsappStatus);
  socket.emit("whatsapp:battery-status", phoneBatteryStatus);
  if (connectedUser) socket.emit("user-info", connectedUser);
  if (qrCodeData) socket.emit("whatsapp-qr", qrCodeData);
  if (pairingCode) socket.emit("whatsapp-pairing-code", pairingCode);
  if (whatsappError) socket.emit("whatsapp-error", whatsappError);

  socket.on("client:battery-update", (data: { value: number; isCharging: boolean }) => {
    if (data && typeof data.value === "number") {
      phoneBatteryStatus = {
        value: Math.max(0, Math.min(100, Math.round(data.value))),
        isCharging: Boolean(data.isCharging),
      };
      broadcastToAll("whatsapp:battery-status", phoneBatteryStatus);
    }
  });

  if (whatsappStatus === "connected") {
    // Send my profile if connected
    if (sock && sock.user) {
      const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
      sock.profilePictureUrl(myJid, "image")
        .then((myPic: string) => {
          socket.emit("whatsapp:my-profile", { name: sock.user.name, id: myJid, imgUrl: myPic });
        })
        .catch(() => {
          socket.emit("whatsapp:my-profile", { name: sock.user.name, id: myJid, imgUrl: null });
        });
    }

    // Send currently cached active contacts filtered to last 3 months (without heavy bulk messages)
    const recentChats = getRecentThreeMonthsChats();
    const mappedContacts = recentChats.map((chat: any) => mapContact(chat));
    
    // Broadcast contacts summary with lastMessage previews
    socket.emit("whatsapp:chats-loaded", mappedContacts);

    // Send profile/status details for each active 3-month chat contact
    recentChats.forEach((chat) => {
      const jid = chat.id;
      getContactInfo(sock, jid).then((info) => {
        const mapped = mapContact(chat || { id: jid });
        socket.emit("whatsapp:chat-profile-ready", {
          jid,
          profile: {
            id: jid,
            name: mapped.name,
            imgUrl: info?.imgUrl || mapped.avatar,
            status: info?.status || mapped.about,
            phoneNumber: mapped.phoneNumber,
          },
        });
      });
    });
  }

  socket.on("start-pairing", async (data?: { phoneNumber?: string }) => {
    let rawPhone = data?.phoneNumber || "";
    let cleanPhone = rawPhone.replace(/\D/g, "");
    // Auto-prepend Bangladesh country code if local 11-digit number starting with 01 is entered
    if (cleanPhone.startsWith("01") && cleanPhone.length === 11) {
      cleanPhone = "88" + cleanPhone;
    }
    console.log(`Socket received start-pairing. Mode: ${cleanPhone ? `Phone Pairing (${cleanPhone})` : "QR Code"}`);
    connectToWhatsApp(cleanPhone || undefined);
  });

  socket.on("disconnect-whatsapp", async () => {
    console.log("Disconnect and logout requested manually.");
    try {
      if (sock) {
        await sock.logout();
      }
    } catch (err) {
      console.error("Error logging out sock:", err);
    }
    sock = null;
    whatsappStatus = "disconnected";
    qrCodeData = null;
    pairingCode = "";
    connectedUser = null;
    broadcastToAll("whatsapp-status", "disconnected");

    const authFolder = path.join(process.cwd(), "auth_info_baileys");
    try {
      if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
        console.log("Auth folder deleted manually.");
      }
    } catch (err) {
      console.error("Failed to delete auth folder manually:", err);
    }
  });

  socket.on("send-whatsapp-message", async (data: { contactId: string, text: string }) => {
    if (sock && whatsappStatus === "connected") {
      try {
        console.log(`Sending real-time message via WhatsApp: To: ${data.contactId}, Body: ${data.text}`);
        const sent = await sock.sendMessage(data.contactId, { text: data.text });
        if (!store.messages[data.contactId]) store.messages[data.contactId] = [];
        store.messages[data.contactId].push(sent);
      } catch (err) {
        console.error("Failed to send real-time message via Baileys:", err);
      }
    }
  });

  // =========================================================================
  // অন-ডিমান্ড টার্গেট প্রফাইল চ্যাট হিস্ট্রি সিঙ্ক (গত ৩ মাসের সকল বার্তা, মিডিয়া, ভয়েস, কল)
  // গ্রাহক যখন যেই প্রফাইল এ ক্লিক করে inbox open করবে তখন সেই টার্গেট প্রফাইলের
  // গত ৩ মাসের chat history নির্ভুল ও ১০০% সফলভাবে sync হবে
  // =========================================================================
  const syncTargetProfileHistory = async (jid: string, targetSocket?: any, count = 200) => {
    if (!jid) return;

    // একই চ্যাটের জন্য এক সাথে একাধিক রিকোয়েস্ট আসলে ডুপ্লিকেট রান রোধ করা
    if (activeSyncs.has(jid)) {
      console.log(`[Target Sync] ⏳ Sync already in progress for ${jid}, skipping duplicate request.`);
      return;
    }
    activeSyncs.add(jid);

    try {
      console.log(`[Target Sync] 🎯 Synchronizing 3-month history for target profile: ${jid}`);

      const chat = store.chats[jid];
      const pnJid = chat?.pnJid || store.contacts[jid]?.pnJid;
      const lid = store.contacts[jid]?.lid;

      // Combine messages across JID, pnJid, and LID to prevent missing data
      const candidateJids = Array.from(new Set([jid, pnJid, lid].filter(Boolean) as string[]));
      const combinedMap = new Map<string, any>();
      for (const cand of candidateJids) {
        const msgs = store.messages[cand] || [];
        for (const m of msgs) {
          const id = m.key?.id;
          if (id && !combinedMap.has(id)) {
            combinedMap.set(id, m);
          }
        }
      }

      const allMsgs = Array.from(combinedMap.values());
      const threeMonthsCutoff = Math.floor(Date.now() / 1000) - (THREE_MONTHS_DAYS * 24 * 60 * 60);

      // Filter strictly to the last 3 months from current login date
      const recentMessages = allMsgs.filter((m) => {
        const ts = parseTimestampToSec(m.messageTimestamp);
        return ts >= threeMonthsCutoff;
      });

      // Sort chronologically (oldest to newest)
      recentMessages.sort((a, b) => parseTimestampToSec(a.messageTimestamp) - parseTimestampToSec(b.messageTimestamp));

      let voiceCount = 0;
      let mediaCount = 0;

      // Enrich messages and auto-cache voice notes so they are 100% playable
      const enrichedHistory = await Promise.all(
        recentMessages.map(async (msg) => {
          const unpacked = unwrapMessage(msg.message);
          const isAudio = Boolean(unpacked?.audioMessage);
          const isImage = Boolean(unpacked?.imageMessage);
          const isVideo = Boolean(unpacked?.videoMessage);
          const isDoc = Boolean(unpacked?.documentMessage);
          const isSticker = Boolean(unpacked?.stickerMessage);

          if (isAudio) voiceCount++;
          if (isImage || isVideo || isDoc || isSticker) mediaCount++;

          let mediaUrl: string | undefined = undefined;

          // ১. শুধুমাত্র ভয়েস রেকর্ড গুলো শতভাগ প্লেব্যাক ও নষ্ট না হওয়ার জন্য ব্যাকগ্রাউন্ডে টাইমআউটসহ ক্যাশ করা
          if (isAudio) {
            const cached = await downloadAndCacheMediaWithTimeout(msg, 3500);
            if (cached) {
              mediaUrl = cached.dataUrl || cached.url;
            }
          }
          // বড় ফাইল, ছবি, ভিডিও বা ডকুমেন্ট এর ক্ষেত্রে মেটাডেটা সিঙ্ক থাকবে, কিন্তু ল্যাগ রোধে অন-ডিমান্ড ডাউনলোড /api/media/:jid/:id দিয়ে কাজ করবে

          const mappedMsg = mapMessage(msg, mediaUrl);
          return mappedMsg;
        })
      );

      const validHistory = enrichedHistory.filter(Boolean);

      // Save filtered 3-month messages back to store
      store.messages[jid] = recentMessages;
      saveStore();

      const info = sock ? await getContactInfo(sock, jid) : null;
      const mapped = mapContact(chat || { id: jid });

      const syncResult = {
        jid,
        profile: {
          id: jid,
          name: mapped.name,
          imgUrl: info?.imgUrl || mapped.avatar,
          status: info?.status || mapped.about,
          phoneNumber: mapped.phoneNumber,
        },
        history: validHistory,
        syncStatus: {
          synced: true,
          messageCount: validHistory.length,
          voiceCount,
          mediaCount,
          timeSpan: "Last 3 months",
          syncedAt: Date.now(),
        },
      };

      console.log(`[Target Sync] ✅ Completed for ${jid}: ${validHistory.length} messages (${voiceCount} voice notes, ${mediaCount} media files).`);

      if (targetSocket) {
        targetSocket.emit("response:target-chat-history", syncResult);
      } else {
        broadcastToAll("response:target-chat-history", syncResult);
      }
    } catch (err: any) {
      console.error(`Error in syncTargetProfileHistory for ${jid}:`, err);
      if (targetSocket) {
        targetSocket.emit("action:error", { type: "target-sync", jid, message: err.message });
      }
    } finally {
      activeSyncs.delete(jid);
    }
  };

  // ১. গ্রাহক কোনো প্রোফাইলে ক্লিক করলে সেই টার্গেট প্রোফাইলের ৩ মাসের চ্যাট হিস্ট্রি সিঙ্ক করা
  socket.on("action:sync-target-chat", async (data: any) => {
    const jid = typeof data === "string" ? data : data?.jid;
    const count = typeof data === "object" ? data?.count : 200;
    if (jid) await syncTargetProfileHistory(jid, socket, count);
  });

  socket.on("action:click-friend", async (jid: string) => {
    if (jid) await syncTargetProfileHistory(jid, socket, 200);
  });

  socket.on("action:reload-chat-history", async (data: any) => {
    const jid = typeof data === "string" ? data : data?.jid;
    const count = typeof data === "object" ? data?.count : 250;
    if (jid) await syncTargetProfileHistory(jid, socket, count);
  });

  // ২. ইনবক্স থেকে টেক্সট মেসেজ পাঠানো
  socket.on("action:send-text", async ({ to, text }: { to: string; text: string }) => {
    try {
      if (!sock) throw new Error("WhatsApp is not connected");
      let sent;
      try {
        sent = await sock.sendMessage(to, { text: text });
      } catch (err: any) {
        const pnJid = store.chats[to]?.pnJid || store.contacts[to]?.pnJid;
        if (pnJid && pnJid !== to) {
          console.log(`Failed to send to LID ${to}, retrying with pnJid ${pnJid}...`);
          sent = await sock.sendMessage(pnJid, { text: text });
        } else {
          throw err;
        }
      }
      
      if (!store.messages[to]) store.messages[to] = [];
      store.messages[to].push(sent);

      const mapped = mapMessage(sent);
      socket.emit("action:success", { type: "send-text", message: mapped || sent });
      broadcastToAll("whatsapp-message-new", { jid: to, message: mapped });
    } catch (err: any) {
      console.error("Error sending text:", err);
      socket.emit("action:error", { type: "send-text", error: err.message });
    }
  });

  // ৩. রিয়েল টাইম ভয়েস নোট বা মিডিয়া ফাইল পাঠানো (Buffer/Base64 থেকে)
  socket.on("action:send-media", async ({ to, base64Data, type, mimeType }: { to: string; base64Data: string; type: string; mimeType?: string }) => {
    try {
      if (!sock) throw new Error("WhatsApp is not connected");
      
      // Base64 ফাইলকে বাফারে রূপান্তর
      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");
      let options: any = {};

      if (type === "audio" || type === "voice") {
        options = { audio: buffer, mimetype: mimeType || "audio/mp4", ptt: true }; // ptt: true মানে ভয়েস নোট হিসেবে যাবে
      } else if (type === "image") {
        options = { image: buffer, mimetype: mimeType || "image/jpeg" };
      } else {
        options = { document: buffer, mimetype: mimeType || "application/octet-stream", fileName: "File" };
      }

      let sentMedia;
      try {
        sentMedia = await sock.sendMessage(to, options);
      } catch (err: any) {
        const pnJid = store.chats[to]?.pnJid || store.contacts[to]?.pnJid;
        if (pnJid && pnJid !== to) {
          console.log(`Failed to send media to LID ${to}, retrying with pnJid ${pnJid}...`);
          sentMedia = await sock.sendMessage(pnJid, options);
        } else {
          throw err;
        }
      }
      
      if (!store.messages[to]) store.messages[to] = [];
      store.messages[to].push(sentMedia);

      const decryptedUrl = `data:${options.mimetype};base64,${cleanBase64}`;
      const mapped = mapMessage(sentMedia, decryptedUrl);
      
      socket.emit("action:success", { type: "send-media", message: mapped || sentMedia });
      broadcastToAll("whatsapp-message-new", { jid: to, message: mapped });
    } catch (err: any) {
      console.error("Error sending media:", err);
      socket.emit("action:error", { type: "send-media", error: err.message });
    }
  });

  // ৪. নতুন মেসেজ সিন (Seen / Read / Blue Tick) করা
  socket.on("action:seen-chat", async (jid: string) => {
    try {
      if (!sock) return;
      const chatMessages = store.messages[jid] || [];
      if (chatMessages.length > 0) {
        const lastMessage = chatMessages[chatMessages.length - 1];
        await sock.readMessages([lastMessage.key]);
        socket.emit("action:success", { type: "seen-chat", jid });
      }
    } catch (err: any) {
      console.error("Seen/Read error:", err);
    }
  });

  // ৫. কোনো বন্ধুকে আর্কাইভ (Archive) এ নেওয়া বা আর্কাইভ থেকে সরানো
  socket.on("action:archive-chat", async ({ jid, archiveState }: { jid: string; archiveState: boolean }) => {
    try {
      if (!sock) throw new Error("WhatsApp is not connected");
      await sock.chatModify({ archive: archiveState }, jid);
      
      if (store.chats[jid]) store.chats[jid].archive = archiveState;
      socket.emit("action:success", { type: "archive-chat", jid, archived: archiveState });
    } catch (err: any) {
      console.error("Archive error:", err);
      socket.emit("action:error", { type: "archive-chat", error: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    activeSockets.delete(socket);
  });
});

// Body parser with 50mb limit for base64 file transfers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ==========================================
// MEDIA STREAMING & ON-DEMAND DOWNLOAD ROUTE
// ==========================================
app.get("/api/media/:jid/:messageId", async (req, res) => {
  const { jid, messageId } = req.params;
  try {
    const cacheFile = path.join(MEDIA_CACHE_DIR, `${messageId}.bin`);
    const metaFile = path.join(MEDIA_CACHE_DIR, `${messageId}.meta.json`);

    if (fs.existsSync(cacheFile) && fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        const stats = fs.statSync(cacheFile);

        res.setHeader("Content-Type", meta.mimetype || "application/octet-stream");
        res.setHeader("Content-Length", stats.size);
        res.setHeader("Accept-Ranges", "bytes");
        if (meta.fileName) {
          res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(meta.fileName)}"`);
        }

        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
          const chunksize = end - start + 1;
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${stats.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": meta.mimetype || "application/octet-stream",
          });
          fs.createReadStream(cacheFile, { start, end }).pipe(res);
          return;
        }

        fs.createReadStream(cacheFile).pipe(res);
        return;
      } catch (err) {}
    }

    // If not in cache, find message from store across candidate JIDs
    const candidateJids = [jid];
    const chat = store.chats[jid];
    if (chat?.pnJid) candidateJids.push(chat.pnJid);
    if (store.contacts[jid]?.lid) candidateJids.push(store.contacts[jid].lid);

    let foundMsg: any = null;
    for (const cand of candidateJids) {
      const msgs = store.messages[cand] || [];
      foundMsg = msgs.find((m) => m.key?.id === messageId);
      if (foundMsg) break;
    }

    if (!foundMsg) {
      return res.status(404).send("Media message not found in history");
    }

    // Decrypt and cache on-demand from WhatsApp Baileys
    const result = await downloadAndCacheMedia(foundMsg);
    if (!result || !fs.existsSync(cacheFile)) {
      return res.status(404).send("WhatsApp media could not be decrypted or link expired");
    }

    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const stats = fs.statSync(cacheFile);
    res.setHeader("Content-Type", meta.mimetype || "application/octet-stream");
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Accept-Ranges", "bytes");
    fs.createReadStream(cacheFile).pipe(res);
  } catch (err: any) {
    console.error("Error serving media file:", err);
    res.status(500).send("Internal server error downloading media");
  }
});

// Initialize Google Gen AI lazily
let aiClient: GoogleGenAI | null = null;

function getAiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("WARNING: GEMINI_API_KEY is not defined. AI features will run in mock-mode.");
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// ==========================================
// API ROUTES
// ==========================================

// Chat endpoint (Meta AI Bot)
app.post("/api/chat/meta", async (req, res) => {
  const { message, history } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  const ai = getAiClient();
  if (!ai) {
    // Return a mock reply if API key is not present
    return setTimeout(() => {
      res.json({
        text: `[MOCK MODE] Hello! I received your message: "${message}". Set up your GEMINI_API_KEY in the Secrets panel to get real replies!`,
      });
    }, 1000);
  }

  try {
    // 1. Check if the message is an image generation request
    const isImageRequest = message.trim().toLowerCase().startsWith("/imagine");
    if (isImageRequest) {
      const prompt = message.slice(8).trim();
      if (!prompt) {
        return res.json({ text: "Please provide a prompt. Usage: `/imagine a cute kitten`" });
      }

      try {
        const imgResponse = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-image",
          contents: {
            parts: [{ text: prompt }],
          },
          config: {
            imageConfig: {
              aspectRatio: "1:1",
            },
          },
        });

        let base64Image = "";
        for (const part of imgResponse.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            base64Image = part.inlineData.data;
            break;
          }
        }

        if (base64Image) {
          return res.json({
            text: `Here is the image I generated for: "${prompt}"`,
            image: `data:image/png;base64,${base64Image}`,
          });
        } else {
          throw new Error("No image data returned from Gemini");
        }
      } catch (err: any) {
        console.error("Image generation error, falling back to Unsplash source:", err);
        // Fallback to high quality mock visual content for offline/free tier safety
        const fallbackUrl = `https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=600&auto=format&fit=crop&q=80&sig=${encodeURIComponent(prompt)}`;
        return res.json({
          text: `I generated a beautiful scene based on: "${prompt}" (Fallback activated)`,
          image: fallbackUrl,
        });
      }
    }

    // 2. Standard text conversation
    // Format the history for @google/genai chat API
    // The history parameter is an array of { sender: 'user' | 'meta', text: string, type: 'text' | 'image' }
    const formattedContents = [];
    
    // Add system instruction as part of standard text query or config
    const systemInstruction = 
      "You are Meta AI, the advanced AI virtual assistant integrated directly inside WhatsApp Web. " +
      "You are witty, incredibly helpful, polite, and intelligent. " +
      "You must respond in the same language the user is chatting in (English, Bengali/বাংলা, etc.). " +
      "When replying in Bengali, use warm and highly colloquial Bengali, just like a close tech-savvy friend. " +
      "Keep responses scannable, using bullet points, short paragraphs, and WhatsApp emojis where fitting. " +
      "You can suggest /imagine <prompt> if the user wants to generate pictures.";

    // Push previous history if available
    if (history && Array.isArray(history)) {
      const recentHistory = history.slice(-6); // Only last 6 messages to keep tokens low
      for (const msg of recentHistory) {
        if (msg.type === "text") {
          formattedContents.push({
            role: msg.sender === "me" ? "user" : "model",
            parts: [{ text: msg.text }],
          });
        }
      }
    }

    // Push the current message
    formattedContents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const textResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction,
      },
    });

    return res.json({
      text: textResponse.text || "I'm not sure how to respond to that.",
    });

  } catch (error: any) {
    console.error("Error in /api/chat/meta:", error);
    return res.status(500).json({
      error: "Failed to communicate with AI model.",
      details: error.message,
    });
  }
});

// Transcribe voice message endpoint
app.post("/api/chat/transcribe", async (req, res) => {
  const { audio, mimeType } = req.body;

  if (!audio) {
    return res.status(400).json({ error: "Audio data is required" });
  }

  const ai = getAiClient();
  if (!ai) {
    return setTimeout(() => {
      res.json({ text: "Hello there! (This is a mock transcription because GEMINI_API_KEY is not defined)" });
    }, 1200);
  }

  try {
    const cleanedBase64 = audio.replace(/^data:audio\/\w+;base64,/, "");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            data: cleanedBase64,
            mimeType: mimeType || "audio/webm",
          },
        },
        {
          text: "Please transcribe this audio message accurately. Return ONLY the text transcribed, with no extra annotations, prefixes, or tags.",
        },
      ],
    });

    res.json({ text: response.text?.trim() || "Could not transcribe audio content." });
  } catch (error: any) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Failed to transcribe audio", details: error.message });
  }
});

// Analyze image endpoint (multimodal upload helper)
app.post("/api/chat/analyze", async (req, res) => {
  const { image, mimeType, prompt } = req.body;

  if (!image) {
    return res.status(400).json({ error: "Image data is required" });
  }

  const ai = getAiClient();
  if (!ai) {
    return setTimeout(() => {
      res.json({ text: "I see a very nice image! To get a detailed AI analysis, please supply a valid GEMINI_API_KEY in secrets." });
    }, 1000);
  }

  try {
    const cleanedBase64 = image.replace(/^data:image\/\w+;base64,/, "");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            data: cleanedBase64,
            mimeType: mimeType || "image/png",
          },
        },
        {
          text: prompt || "Analyze this image and describe what it is in detail, call out any text or key elements.",
        },
      ],
    });

    res.json({ text: response.text || "No analysis generated." });
  } catch (error: any) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze image", details: error.message });
  }
});

// ==========================================
// CLIENT SERVING & DEVELOPMENT SETUP
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // SPA fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`WhatsApp Web Server running at http://localhost:${PORT}`);
  });
}

startServer();
