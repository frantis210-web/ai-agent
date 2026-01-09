export interface Product {
  id: string;
  name: string;
  price: string;
  originalPrice?: string;
  description: string;
  tag?: string;
}

export interface MessageLog {
  role: 'user' | 'ai' | 'system';
  text: string;
  timestamp: Date;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
