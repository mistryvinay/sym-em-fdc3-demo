const TEXT_MARKDOWN = "text/markdown";
const SYMPHONY_ENTITY = "fdc3.symphonyEntity";
const TREASURY_EXCEPTION_TYPE = "com.mistryvinay.treasury.exception";
const TREASURY_EXCEPTION_VERSION = "1.0";

export function buildSymphonyMessage(row, origin = {}) {
  return buildStructuredObjectMessage([row], origin);
}

export function buildSymphonyBatchMessage(rows, origin = {}) {
  return buildStructuredObjectMessage(rows, origin);
}

function buildStructuredObjectMessage(rows, origin) {
  const safeRows = rows.filter(Boolean);

  if (safeRows.length === 0) {
    throw new Error("At least one payment exception is required to build a structured object message.");
  }

  const primaryRow = safeRows[0];
  const messageId = safeRows.length === 1
    ? `treasury-${primaryRow.id}-${Date.now()}`
    : `treasury-batch-${safeRows.length}-${Date.now()}`;
  const entityId = `${messageId}-structured-object`;
  const structuredObjectData = buildStructuredObjectData({
    rows: safeRows,
    messageId,
    entityId,
    origin
  });

  const message = {
    text: {
      [TEXT_MARKDOWN]: [
        buildVisibleFallbackSummary(structuredObjectData),
        buildStructuredObjectPlaceholder(entityId, structuredObjectData)
      ].join("\n\n")
    },
    entities: {
      [entityId]: {
        type: SYMPHONY_ENTITY,
        data: structuredObjectData
      }
    }
  };

  return {
    metadata: {
      messageId,
      entityId,
      objectType: TREASURY_EXCEPTION_TYPE,
      rowCount: safeRows.length
    },
    message
  };
}

function buildStructuredObjectPlaceholder(entityId, data) {
  return [
    `<div class="entity" data-entity-id="${escapeHtml(entityId)}">`,
    `<i>Structured object attached. Use the rendered card below to review and take action.</i>`,
    "</div>"
  ].join("");
}

function buildVisibleFallbackSummary(data) {
  return `**${data.header.title}**`;
}

export function buildSendOptions({ streamId, activeStreamId }) {
  const options = {
    mode: "blast"
  };

  const resolvedStreamId = streamId || activeStreamId;
  if (resolvedStreamId) {
    options.streamIds = [resolvedStreamId];
  }

  return options;
}

export function buildActionIntentRequest(payload) {
  const data = readStructuredObjectData(payload);
  const actions = readRecords(data.actions).map((action) => ({
    actionId: readRequiredString(action.id, "action.id"),
    action: readRequiredString(action.type, "action.type"),
    label: readRequiredString(action.label, "action.label"),
    exceptionId: readRequiredString(action.exceptionId, "action.exceptionId")
  }));

  if (actions.length === 0) {
    throw new Error("At least one structured object action is required to create action intents.");
  }

  return {
    messageId: readRequiredString(data.messageId, "messageId"),
    entityId: readRequiredString(data.entityId, "entityId"),
    origin: data.origin || {},
    actions
  };
}

export function attachActionIntentsToMessage(payload, actionIntentResponse) {
  const data = readStructuredObjectData(payload);
  const actions = readRecords(data.actions);
  const intents = readRecords(actionIntentResponse?.intents);
  const intentByExceptionId = new Map(
    intents.map((intent) => [
      readRequiredString(intent.exceptionId, "intent.exceptionId"),
      {
        actionIntentId: readRequiredString(intent.actionIntentId, "intent.actionIntentId"),
        actionToken: readRequiredString(intent.actionToken, "intent.actionToken"),
        allowedActionIds: readStringArray(intent.allowedActionIds)
      }
    ])
  );

  if (actions.length === 0) {
    throw new Error("Cannot attach action intents to a message without actions.");
  }

  data.actions = actions.map((action) => {
    const actionId = readRequiredString(action.id, "action.id");
    const exceptionId = readRequiredString(action.exceptionId, "action.exceptionId");
    const intent = intentByExceptionId.get(exceptionId);

    if (!intent) {
      throw new Error(`Missing action intent for exception ${exceptionId}.`);
    }

    if (!intent.allowedActionIds.includes(actionId)) {
      throw new Error(`Action intent for exception ${exceptionId} does not allow ${actionId}.`);
    }

    return {
      ...action,
      actionIntentId: intent.actionIntentId,
      actionToken: intent.actionToken,
      allowedActionIds: intent.allowedActionIds
    };
  });

  return payload;
}

export function redactActionTokens(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactActionTokens(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "actionToken" ? "[redacted]" : redactActionTokens(child)
    ])
  );
}

function buildStructuredObjectData({ rows, messageId, entityId, origin }) {
  const items = rows.map((row) => buildStructuredObjectItem(row));
  const primaryItem = items[0];
  const isBatch = items.length > 1;
  const createdAt = new Date().toISOString();

  return {
    type: TREASURY_EXCEPTION_TYPE,
    version: TREASURY_EXCEPTION_VERSION,
    id: entityId,
    entityId,
    messageId,
    name: isBatch
      ? `Treasury exception batch (${items.length})`
      : `Treasury exception ${primaryItem.exceptionId}`,
    header: {
      title: isBatch
        ? `Treasury exception batch (${items.length})`
        : `Treasury exception ${primaryItem.exceptionId}: ${primaryItem.recommendedAction}`,
      subtitle: isBatch
        ? items.map((item) => item.exceptionId).join(", ")
        : `${primaryItem.counterparty} / ${primaryItem.amount}`
    },
    details: primaryItem,
    items,
    actions: items.flatMap((item) => buildStructuredObjectActions(item)),
    origin: {
      ...origin,
      hostMessageId: messageId,
      sentAt: createdAt
    },
    createdAt
  };
}

function buildStructuredObjectItem(row) {
  return {
    exceptionId: row.id,
    counterparty: row.counterparty,
    amount: row.amount,
    cutoff: row.cutoff,
    owner: row.owner,
    instrument: row.instrument,
    recommendedAction: row.action,
    risk: row.risk,
    settlementDate: row.settlementDate,
    reason: row.reason
  };
}

function buildStructuredObjectActions(item) {
  const suffix = normalizeActionId(item.exceptionId);

  return [
    {
      id: `acknowledge-${suffix}`,
      label: "Acknowledge",
      type: "acknowledge",
      exceptionId: item.exceptionId
    },
    {
      id: `escalate-${suffix}`,
      label: "Escalate",
      type: "escalate",
      exceptionId: item.exceptionId
    }
  ];
}

function normalizeActionId(value) {
  return String(value).trim().replace(/[^A-Za-z0-9_-]+/g, "-");
}

function readStructuredObjectData(payload) {
  const entityId = payload?.metadata?.entityId;
  const entity = entityId ? payload?.message?.entities?.[entityId] : null;

  if (!entity?.data || typeof entity.data !== "object") {
    throw new Error("Structured object message data is required.");
  }

  return entity.data;
}

function readRecords(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readRequiredString(value, fieldName) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  throw new Error(`Structured object ${fieldName} is required.`);
}

function readStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
