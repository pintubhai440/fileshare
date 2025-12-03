export interface TransferFile {
  id: string; // Unique 6-character code
  name: string;
  size: number;
  type: string;
  pin: string;
  blobUrl: string; // Local blob URL for demo purposes
  createdAt: number;
  expiresAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
  groundingUrls?: { title: string; uri: string }[];
}

export enum Tab {
  SEND = 'SEND',
  RECEIVE = 'RECEIVE'
}
