export type MessageType = "text" | "image" | "voice" | "file" | "video" | "sticker" | "contact" | "location" | "poll" | "call";
export type MessageStatus = "sent" | "delivered" | "read";

export interface MessageReaction {
  emoji: string;
  sender: "me" | "them";
}

export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // List of user names/identifiers who voted for this option
}

export interface PollData {
  question: string;
  options: PollOption[];
  multipleAnswers?: boolean;
}

export interface ContactCard {
  name: string;
  phone: string;
  avatar?: string;
  about?: string;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  name: string;
  address?: string;
}

export interface CallData {
  callType: "audio" | "video";
  status: "missed" | "incoming" | "outgoing" | "ended";
  duration?: string;
  date?: string;
}

export interface MessageReply {
  messageId: string;
  text: string;
  sender: "me" | "them";
}

export interface Message {
  id: string;
  sender: "me" | "them";
  text: string;
  timestamp: string;
  type: MessageType;
  status: MessageStatus;
  fileName?: string;
  fileSize?: string;
  fileUrl?: string;
  isHeavy?: boolean;
  isDownloaded?: boolean;
  callData?: CallData;
  voiceDuration?: string;
  isTranscribing?: boolean;
  transcription?: string;
  reactions?: MessageReaction[];
  pollData?: PollData;
  contactCard?: ContactCard;
  locationData?: LocationData;
  replyTo?: MessageReply;
  rawTimestamp?: number; // Unix timestamp in seconds
}

export interface GroupParticipant {
  id: string;
  name: string;
  role: "admin" | "member";
  avatar?: string;
}

export interface ContactSyncStatus {
  synced: boolean;
  syncing?: boolean;
  messageCount?: number;
  voiceCount?: number;
  mediaCount?: number;
  syncedAt?: number;
  timeSpan?: string;
}

export interface Contact {
  id: string;
  name: string;
  avatar: string;
  verified?: boolean;
  isGroup: boolean;
  unreadCount: number;
  about: string;
  status: "online" | "offline" | "typing...";
  phoneNumber?: string;
  conversationTimestamp?: number; // Unix timestamp in seconds of last message
  lastActivityTimestamp?: number; // Unix timestamp in seconds
  lastMessage?: Message;
  syncStatus?: ContactSyncStatus;
  
  // Group specific properties
  groupDescription?: string;
  inviteLink?: string;
  onlyAdminsCanSend?: boolean;
  participants?: GroupParticipant[];

  // User actions
  isMuted?: boolean;
  muteDuration?: string;
  muteUntil?: number;
  isBlocked?: boolean;
  archive?: boolean;
  isPinned?: boolean;
  isFavorite?: boolean;
  listName?: string;
  customLists?: string[];
}

export interface Chat {
  contactId: string;
  messages: Message[];
}

export interface UserProfile {
  name: string;
  about: string;
  avatar: string;
  phoneNumber: string;
}

