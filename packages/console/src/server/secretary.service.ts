import { create } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";
import {
  ClearSecretaryChatResponseSchema,
  GetSecretaryStateResponseSchema,
  SecretaryMessageSchema,
  SecretaryMessageStatus,
  SecretaryRole,
  type SecretaryService,
  SecretarySettingsSchema,
  SecretaryStateSchema,
  SendBossMessageResponseSchema,
  UpdateSecretarySettingsResponseSchema,
} from "@contagxt/axa-proto";
import {
  clearSecretaryChat,
  getSecretarySettings,
  getSecretaryState,
  type PublicSecretarySettings,
  type SecretaryChatMessage,
  sendBossMessage,
  updateSecretarySettings,
} from "@contagxt/axa-secretary";

const ROLE_TO_PROTO = {
  boss: SecretaryRole.BOSS,
  secretary: SecretaryRole.SECRETARY,
} as const;

const STATUS_TO_PROTO = {
  done: SecretaryMessageStatus.DONE,
  pending: SecretaryMessageStatus.PENDING,
  error: SecretaryMessageStatus.ERROR,
} as const;

function toMessage(message: SecretaryChatMessage) {
  return create(SecretaryMessageSchema, {
    id: message.id,
    role: ROLE_TO_PROTO[message.role],
    body: message.body,
    createdAt: message.createdAt,
    status: STATUS_TO_PROTO[message.status],
    taskId: message.taskId ?? "",
    projectId: message.projectId ?? "",
  });
}

function toSettings(settings: PublicSecretarySettings) {
  return create(SecretarySettingsSchema, {
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: settings.hasApiKey,
    updatedAt: settings.updatedAt ?? "",
  });
}

export const secretaryServiceImpl: ServiceImpl<typeof SecretaryService> = {
  async getSecretaryState() {
    const [state, settings] = await Promise.all([getSecretaryState(), getSecretarySettings()]);
    return create(GetSecretaryStateResponseSchema, {
      state: create(SecretaryStateSchema, {
        messages: state.messages.map(toMessage),
        busy: state.busy,
      }),
      settings: toSettings(settings),
    });
  },

  async sendBossMessage(req) {
    const message = await sendBossMessage({ message: req.message });
    return create(SendBossMessageResponseSchema, { message: toMessage(message) });
  },

  async updateSecretarySettings(req) {
    const settings = await updateSecretarySettings({
      ...(req.baseUrl ? { baseUrl: req.baseUrl } : {}),
      ...(req.model ? { model: req.model } : {}),
      ...(req.apiKey ? { apiKey: req.apiKey } : {}),
      ...(req.clearApiKey ? { clearApiKey: true } : {}),
    });
    return create(UpdateSecretarySettingsResponseSchema, {
      settings: toSettings(settings),
    });
  },

  async clearSecretaryChat() {
    await clearSecretaryChat();
    return create(ClearSecretaryChatResponseSchema, {});
  },
};
