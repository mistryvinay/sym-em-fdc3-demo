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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
