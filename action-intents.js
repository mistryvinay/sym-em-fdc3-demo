import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const ACTION_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
export const ACTION_INTENT_TOKEN_BYTES = 32;

const SECRET_FIELD_NAMES = new Set(["actionToken", "tokenHash"]);

export function createActionIntentStore(options = {}) {
  const ttlMs = readPositiveNumber(options.ttlMs, ACTION_INTENT_TTL_MS);
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const generateId = typeof options.generateId === "function" ? options.generateId : () => randomUUID();
  const generateToken = typeof options.generateToken === "function" ? options.generateToken : createActionToken;
  const intentsById = new Map();

  return {
    createIntents(request) {
      const validation = validateCreateActionIntentsRequest(request);
      if (!validation.ok) {
        return {
          ok: false,
          statusCode: 400,
          error: "invalid_action_intents_request",
          reason: validation.reason,
        };
      }

      const issuedAt = readNow(now);
      const expiresAt = new Date(issuedAt.getTime() + ttlMs).toISOString();
      const intents = groupActionsByException(request.actions).map((group) => {
        const actionToken = generateToken();
        const actionIntentId = generateId();

        intentsById.set(actionIntentId, {
          actionIntentId,
          tokenHash: hashActionToken(actionToken),
          messageId: request.messageId,
          entityId: request.entityId,
          exceptionId: group.exceptionId,
          allowedActionIds: group.allowedActionIds,
          expiresAt,
          createdAt: issuedAt.toISOString(),
          consumedAt: null,
          consumedActionId: null,
          consumedAuditEventId: null,
        });

        return {
          exceptionId: group.exceptionId,
          actionIntentId,
          actionToken,
          allowedActionIds: group.allowedActionIds,
        };
      });

      return {
        ok: true,
        statusCode: 201,
        response: {
          expiresAt,
          intents,
        },
      };
    },

    consumeAuditPayload(payload) {
      const validation = validateConsumeAuditPayload(payload);
      if (!validation.ok) {
        return rejectAction(400, "rejected", validation.reason);
      }

      const intent = intentsById.get(payload.actionIntentId);
      if (!intent || !isMatchingToken(payload.actionToken, intent.tokenHash)) {
        return rejectAction(403, "rejected", "invalid_action_token");
      }

      const receivedAt = readNow(now);
      if (receivedAt.getTime() > Date.parse(intent.expiresAt)) {
        return rejectAction(410, "expired", "action_intent_expired", intent);
      }

      if (intent.consumedAt) {
        return rejectAction(409, "already_actioned", "action_intent_already_consumed", intent);
      }

      if (
        payload.messageId !== intent.messageId ||
        payload.entityId !== intent.entityId ||
        payload.exceptionId !== intent.exceptionId
      ) {
        return rejectAction(403, "rejected", "action_context_mismatch", intent);
      }

      if (!intent.allowedActionIds.includes(payload.actionId)) {
        return rejectAction(403, "rejected", "action_not_allowed", intent);
      }

      intent.consumedAt = receivedAt.toISOString();
      intent.consumedActionId = payload.actionId;
      intent.consumedAuditEventId = readString(payload.auditEventId);

      return {
        accepted: true,
        statusCode: 202,
        status: "accepted",
        reason: "accepted",
        intent: sanitizeIntentForResponse(intent),
      };
    },
  };
}

export function createActionToken() {
  return randomBytes(ACTION_INTENT_TOKEN_BYTES).toString("base64url");
}

export function hashActionToken(actionToken) {
  return createHash("sha256").update(String(actionToken), "utf8").digest("hex");
}

export function sanitizeAuditEnvelope(envelope, payloadOverrides = {}) {
  const sanitized = redactActionSecrets(envelope);
  const sanitizedPayload = getRecord(sanitized.payload);

  return {
    ...sanitized,
    payload: {
      ...sanitizedPayload,
      ...payloadOverrides,
    },
  };
}

export function redactActionSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactActionSecrets(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_FIELD_NAMES.has(key))
      .map(([key, child]) => [key, redactActionSecrets(child)]),
  );
}

function validateCreateActionIntentsRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return invalid("request_must_be_object");
  }

  if (!readString(request.messageId)) {
    return invalid("message_id_required");
  }

  if (!readString(request.entityId)) {
    return invalid("entity_id_required");
  }

  if (!Array.isArray(request.actions) || request.actions.length === 0) {
    return invalid("actions_required");
  }

  for (const action of request.actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      return invalid("action_must_be_object");
    }

    if (!readString(action.actionId)) {
      return invalid("action_id_required");
    }

    if (!readString(action.exceptionId)) {
      return invalid("exception_id_required");
    }
  }

  return { ok: true };
}

function validateConsumeAuditPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return invalid("payload_must_be_object");
  }

  const requiredFields = [
    "auditEventId",
    "actionIntentId",
    "actionToken",
    "actionId",
    "messageId",
    "entityId",
    "exceptionId",
  ];

  for (const field of requiredFields) {
    if (!readString(payload[field])) {
      return invalid(`${field}_required`);
    }
  }

  return { ok: true };
}

function groupActionsByException(actions) {
  const groups = new Map();

  actions.forEach((action) => {
    const exceptionId = readString(action.exceptionId);
    const actionId = readString(action.actionId);
    const group = groups.get(exceptionId) || {
      exceptionId,
      allowedActionIds: [],
    };

    if (!group.allowedActionIds.includes(actionId)) {
      group.allowedActionIds.push(actionId);
    }

    groups.set(exceptionId, group);
  });

  return Array.from(groups.values());
}

function isMatchingToken(actionToken, expectedHash) {
  const actualHash = Buffer.from(hashActionToken(actionToken), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actualHash.length === expected.length && timingSafeEqual(actualHash, expected);
}

function rejectAction(statusCode, status, reason, intent = null) {
  return {
    accepted: false,
    statusCode,
    status,
    reason,
    intent: intent ? sanitizeIntentForResponse(intent) : null,
  };
}

function sanitizeIntentForResponse(intent) {
  return {
    actionIntentId: intent.actionIntentId,
    messageId: intent.messageId,
    entityId: intent.entityId,
    exceptionId: intent.exceptionId,
    allowedActionIds: intent.allowedActionIds,
    expiresAt: intent.expiresAt,
    consumedAt: intent.consumedAt,
    consumedActionId: intent.consumedActionId,
  };
}

function invalid(reason) {
  return {
    ok: false,
    reason,
  };
}

function readPositiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Action intent clock returned an invalid date.");
  }

  return date;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function getRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
