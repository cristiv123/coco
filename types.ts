
export interface TranscriptionPart {
  text: string;
  isUser: boolean;
  timestamp: number;
}

export enum ConnectionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface ConversationState {
  status: ConnectionStatus;
  isListening: boolean;
  isSpeaking: boolean;
  transcription: TranscriptionPart[];
}
