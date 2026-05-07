const TEXT_MARKDOWN = "text/markdown";

export function buildSymphonyMessage(row) {
  const messageId = `treasury-${row.id}-${Date.now()}`;
  const acknowledgeActionId = buildActionId(messageId, "acknowledge");
  const escalateActionId = buildActionId(messageId, "escalate");

  const markdown = [
    `**Treasury exception ${row.id}: ${row.action}**`,
    "",
    `Counterparty: ${row.counterparty}`,
    `Amount: ${row.amount}`,
    `Cutoff: ${row.cutoff}`,
    `Settlement date: ${row.settlementDate}`,
    "",
    row.reason,
    "",
    `§[Acknowledge](id/${acknowledgeActionId}) §[Escalate](id/${escalateActionId})`
  ].join("\n");

  /*
   * FDC3 action buttons in SharedMessage payloads are two-part:
   * 1. Markdown uses the special id/<entityId> link target.
   * 2. entities[entityId] must exist as an fdc3.fdc3Intent object.
   *
   * If either side is missing or the ids do not match, the button renders
   * but the callback will not surface the intended custom action payload.
  *
  * Action ids are message-scoped rather than row-scoped so later copies of
  * the same exception card do not inherit one-shot handling state.
   */
  const message = {
    text: {
      [TEXT_MARKDOWN]: markdown
    },
    entities: {
      [acknowledgeActionId]: {
        type: "fdc3.fdc3Intent",
        data: {
          title: "Acknowledge",
          intent: "AcknowledgeException",
          context: buildInteractionContext(row, acknowledgeActionId)
        }
      },
      [escalateActionId]: {
        type: "fdc3.fdc3Intent",
        data: {
          title: "Escalate",
          intent: "EscalateException",
          context: buildInteractionContext(row, escalateActionId, { escalationRequested: true })
        }
      }
    }
  };

  return {
    metadata: { messageId },
    message
  };
}

export function buildSendOptions({ streamId, activeStreamId, containerSelector }) {
  const options = {
    mode: "blast",
    container: containerSelector
  };

  const resolvedStreamId = streamId || activeStreamId;
  if (resolvedStreamId) {
    options.streamIds = [resolvedStreamId];
  }

  return options;
}

export function isMissingContainerError(error) {
  return Boolean(error && typeof error.message === "string" && error.message.includes("container does not exist"));
}

export function omitContainer(options) {
  const { container, ...rest } = options;
  return rest;
}

function buildActionId(messageId, action) {
  return `${messageId}-${action}`;
}

function buildInteractionContext(row, actionId, overrides = {}) {
  return {
    type: "fdc3.interaction",
    name: `Treasury exception ${row.id}`,
    id: {
      exceptionId: row.id,
      actionId
    },
    participants: [
      {
        type: "fdc3.organization",
        name: row.counterparty
      }
    ],
    interactionType: "workflow-action",
    timeRange: {
      startTime: new Date().toISOString()
    },
    details: {
      amount: row.amount,
      cutoff: row.cutoff,
      owner: row.owner,
      instrument: row.instrument,
      requiredAction: row.action,
      risk: row.risk,
      settlementDate: row.settlementDate,
      reason: row.reason,
      ...overrides
    }
  };
}