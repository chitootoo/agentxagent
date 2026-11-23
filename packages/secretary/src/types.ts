export const SECRETARY_ROLES = ["boss", "secretary"] as const;
export type SecretaryRole = (typeof SECRETARY_ROLES)[number];

export const SECRETARY_MESSAGE_STATUSES = ["done", "pending", "error"] as const;
export type SecretaryMessageStatus = (typeof SECRETARY_MESSAGE_STATUSES)[number];

export interface SecretarySettings {
  version: 1;
  /** Model endpoint. OpenAI-compatible URLs and Gemini native URLs are both accepted. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  updatedAt?: string;
}

export interface SecretaryChatMessage {
  id: string;
  role: SecretaryRole;
  body: string;
  createdAt: string;
  status: SecretaryMessageStatus;
  /** Task created or discussed by the secretary. */
  taskId?: string;
  /** Project that owns the task, used for the console deep link. */
  projectId?: string;
  /** Secretary messages point back to the boss message they answer. */
  inReplyTo?: string;
}

export interface SecretaryChatState {
  version: 1;
  messages: SecretaryChatMessage[];
}

export interface SecretaryState {
  messages: SecretaryChatMessage[];
  busy: boolean;
}

export interface PublicSecretarySettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  updatedAt?: string;
}

export interface UpdateSecretarySettingsInput {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface SendBossMessageInput {
  message: string;
}

export const DEFAULT_SETTINGS: SecretarySettings = {
  version: 1,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1",
};
