export const ACTION_INTENT_TTL_MS: number;
export const ACTION_INTENT_TOKEN_BYTES: number;

export type ActionIntentRequest = {
  messageId: string;
  entityId: string;
  origin?: Record<string, unknown>;
  actions: Array<{
    actionId: string;
    action: string;
    label: string;
    exceptionId: string;
  }>;
};

export type ActionIntentResponse = {
  expiresAt: string;
  intents: Array<{
    exceptionId: string;
    actionIntentId: string;
    actionToken: string;
    allowedActionIds: string[];
  }>;
};

export type ActionIntentStore = {
  createIntents(request: unknown): {
    ok: boolean;
    statusCode: number;
    response?: ActionIntentResponse;
    error?: string;
    reason?: string;
  };
  consumeAuditPayload(payload: unknown): {
    accepted: boolean;
    statusCode: number;
    status: string;
    reason: string;
    intent: Record<string, unknown> | null;
  };
};

export function createActionIntentStore(options?: {
  ttlMs?: number;
  now?: () => Date | string | number;
  generateId?: () => string;
  generateToken?: () => string;
}): ActionIntentStore;

export function createActionToken(): string;
export function hashActionToken(actionToken: string): string;
export function sanitizeAuditEnvelope(
  envelope: Record<string, unknown>,
  payloadOverrides?: Record<string, unknown>,
): Record<string, unknown>;
export function redactActionSecrets(value: unknown): unknown;
