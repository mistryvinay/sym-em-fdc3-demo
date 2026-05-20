import { registerRenderer } from '@symphony-ui/adk/lib/impl/Messages';

import type { RuntimeConfig } from './config';

type StructuredObjectData = Record<string, unknown>;
type StructuredActionPayload = {
  data?: unknown;
  extraData?: unknown;
};
type StructuredObjectItem = {
  exceptionId: string;
  counterparty: string;
  amount: string;
  cutoff: string;
  owner: string;
  instrument: string;
  requiredAction: string;
  risk: string;
  settlementDate: string;
  reason: string;
};
type StructuredObjectAction = {
  id: string;
  label: string;
  type: string;
  exceptionId: string;
};
type StructuredObjectOrigin = {
  streamId: string | null;
  hostPage: string | null;
  hostMessageId: string | null;
  sentAt: string | null;
};
type RendererActions = {
  [actionId: string]: {
    label: string;
    data?: Object;
  };
};
export type ViewerContext = {
  userId: string;
  displayName: string;
  email: string;
  username: string;
} | null;

const SHARED_MESSAGE_SYMPHONY_ENTITY_TYPE = 'fdc3.symphonyEntity';
const AUDIT_EVENT_SOURCE = 'sym-em-structured-object-extension';
const AUDIT_EVENT_TYPE = 'structured-object.action.audit';
const processedActions = new Set<string>();

export function hasSymphonyHostContext(
  currentWindow: Window | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!currentWindow) {
    return false;
  }

  const params = new URLSearchParams(currentWindow.location.search);

  return (
    params.has('handle') ||
    params.has('clientId') ||
    currentWindow.parent !== currentWindow ||
    Boolean(currentWindow.opener)
  );
}

export function registerStructuredObjectRenderer(options: {
  config: RuntimeConfig;
  viewer: ViewerContext;
}): void {
  const { config, viewer } = options;
  const onRender = (entityData: StructuredObjectData) => renderTreasuryException(config, entityData);
  const onAction = (actionId: string, actionPayload?: StructuredActionPayload) => {
    void publishAuditEvent({
      config,
      actionId,
      actionPayload,
      viewer,
    });
  };

  registerRenderer(config.objectType, onRender, onAction);
  registerRenderer(SHARED_MESSAGE_SYMPHONY_ENTITY_TYPE, onRender, onAction);

  window.console.info('structured-object.renderer.registered', {
    objectTypes: [config.objectType, SHARED_MESSAGE_SYMPHONY_ENTITY_TYPE],
  });
}

function publishAuditEvent(options: {
  config: RuntimeConfig;
  actionId: string;
  actionPayload?: StructuredActionPayload;
  viewer: ViewerContext;
}): Promise<void> {
  const { config, actionId, actionPayload, viewer } = options;
  const payloadData = getRecord(actionPayload?.data);
  const extraData = getRecord(actionPayload?.extraData);
  const exceptionId = readString(payloadData.exceptionId) || readString(extraData.exceptionId);
  const messageId = readString(payloadData.messageId) || readString(extraData.messageId);
  const entityId = readString(payloadData.entityId) || readString(extraData.entityId);
  const origin = readOrigin(payloadData.origin) || readOrigin(extraData.origin);
  const auditKey = [messageId, exceptionId, actionId].filter(Boolean).join(':');
  const duplicate = auditKey ? processedActions.has(auditKey) : false;

  if (auditKey && !duplicate) {
    processedActions.add(auditKey);
  }

  const auditEvent = {
    source: AUDIT_EVENT_SOURCE,
    type: AUDIT_EVENT_TYPE,
    version: 1,
    payload: {
      auditEventId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      auditKey: auditKey || null,
      status: duplicate ? 'duplicateIgnored' : 'accepted',
      actionId,
      action: readString(payloadData.action) || actionId,
      label: readString(payloadData.label) || actionId,
      messageId,
      entityId,
      exceptionId,
      origin,
      actor: viewer,
      occurredAt: new Date().toISOString(),
      actionPayload: actionPayload || null,
    },
  };

  window.console.info('structured-object.action.audit', auditEvent.payload);
  window.top?.postMessage(auditEvent, '*');

  return publishAuditEventToEndpoint(config.auditEndpointUrl, auditEvent);
}

async function publishAuditEventToEndpoint(
  auditEndpointUrl: string | undefined,
  auditEvent: Record<string, unknown>,
): Promise<void> {
  if (!auditEndpointUrl) {
    window.console.info('structured-object.action.audit.endpoint.skipped', {
      reason: 'No auditEndpointUrl configured. Production deployments should send audit events to an authenticated backend.',
    });
    return;
  }

  try {
    const response = await fetch(auditEndpointUrl, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditEvent),
    });

    if (!response.ok) {
      window.console.warn('structured-object.action.audit.endpoint.failed', {
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }

    window.console.info('structured-object.action.audit.endpoint.sent', {
      status: response.status,
    });
  } catch (error) {
    window.console.warn('structured-object.action.audit.endpoint.failed', error);
  }
}

function renderTreasuryException(config: RuntimeConfig, entityData: StructuredObjectData) {
  const data = normalizeEntityData(entityData);

  if (readString(data.type) !== config.objectType) {
    return {
      template: '<entity><span>Unsupported structured object.</span></entity>',
      extraData: {
        receivedType: readString(data.type) || 'unknown',
      },
    };
  }

  const header = getRecord(data.header);
  const entityId = readString(data.entityId) || readString(data.id) || null;
  const messageId = readString(data.messageId) || null;
  const origin = readOrigin(data.origin);
  const items = readStructuredItems(data);
  const title = readString(header.title) || readString(data.name) || 'Treasury exception';
  const subtitle = readString(header.subtitle) || `${items.length} item${items.length === 1 ? '' : 's'}`;
  const actions = buildRendererActions(data, items, entityId, messageId, origin);

  return {
    template: [
      '<entity>',
      `<b>${escapeXml(title)}</b><br/>`,
      `<span>${escapeXml(subtitle)}</span><br/>`,
      items.map((item) => renderItem(item, data)).join('<br/>'),
      '</entity>',
    ].join(''),
    extraData: {
      entityId,
      messageId,
      origin,
    },
    actions,
  };
}

function renderItem(item: StructuredObjectItem, data: StructuredObjectData): string {
  const actions = readActionsForItem(data, item);

  return [
    `<span><b>${escapeXml(item.exceptionId)}: ${escapeXml(item.requiredAction)}</b></span><br/>`,
    `<span>${escapeXml(item.counterparty)} / ${escapeXml(item.amount)}</span><br/>`,
    `<span>${escapeXml(item.reason)}</span><br/>`,
    `<span><b>Cutoff</b>: ${escapeXml(item.cutoff)}</span><br/>`,
    `<span><b>Risk</b>: ${escapeXml(item.risk)}</span><br/>`,
    actions.map((action) => (
      `<action id="${escapeXml(action.id)}" class="tk-button ${buttonClassForAction(action.type)} tk-button--small" />`
    )).join(''),
  ].join('');
}

function buildRendererActions(
  data: StructuredObjectData,
  items: StructuredObjectItem[],
  entityId: string | null,
  messageId: string | null,
  origin: StructuredObjectOrigin | null,
): RendererActions {
  const actionEntries = items.flatMap((item) => (
    readActionsForItem(data, item).map((action) => [
      action.id,
      {
        label: action.label,
        data: {
          label: action.label,
          action: action.type,
          actionId: action.id,
          entityId,
          exceptionId: item.exceptionId,
          messageId,
          origin,
          details: item,
        },
      },
    ] as const)
  ));

  return Object.fromEntries(actionEntries);
}

function readStructuredItems(data: StructuredObjectData): StructuredObjectItem[] {
  const itemRecords = readRecords(data.items);
  const records = itemRecords.length > 0 ? itemRecords : [getRecord(data.details)];

  return records.map((record) => ({
    exceptionId: readString(record.exceptionId) || readString(data.exceptionId) || 'unknown',
    counterparty: readString(record.counterparty) || '-',
    amount: readString(record.amount) || '-',
    cutoff: readString(record.cutoff) || '-',
    owner: readString(record.owner) || '-',
    instrument: readString(record.instrument) || '-',
    requiredAction: readString(record.requiredAction) || 'Review',
    risk: readString(record.risk) || '-',
    settlementDate: readString(record.settlementDate) || '-',
    reason: readString(record.reason) || 'Review required before settlement.',
  }));
}

function readActionsForItem(data: StructuredObjectData, item: StructuredObjectItem): StructuredObjectAction[] {
  const actions = readRecords(data.actions)
    .filter((action) => {
      const actionExceptionId = readString(action.exceptionId);

      return !actionExceptionId || actionExceptionId === item.exceptionId;
    })
    .map((action) => ({
      id: readString(action.id) || `${readString(action.type) || 'action'}-${normalizeActionId(item.exceptionId)}`,
      label: readString(action.label) || readString(action.type) || 'Action',
      type: readString(action.type) || readString(action.id) || 'action',
      exceptionId: item.exceptionId,
    }));

  if (actions.length > 0) {
    return actions;
  }

  return [
    {
      id: `acknowledge-${normalizeActionId(item.exceptionId)}`,
      label: 'Acknowledge',
      type: 'acknowledge',
      exceptionId: item.exceptionId,
    },
    {
      id: `escalate-${normalizeActionId(item.exceptionId)}`,
      label: 'Escalate',
      type: 'escalate',
      exceptionId: item.exceptionId,
    },
  ];
}

function buttonClassForAction(actionType: string): string {
  return actionType === 'acknowledge' ? 'tk-button--primary' : 'tk-button--secondary';
}

function normalizeEntityData(value: StructuredObjectData): StructuredObjectData {
  const nestedData = getRecord(value.data);

  if (readString(value.type) === SHARED_MESSAGE_SYMPHONY_ENTITY_TYPE && Object.keys(nestedData).length > 0) {
    return nestedData;
  }

  return value;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((item) => getRecord(item)).filter((item) => Object.keys(item).length > 0)
    : [];
}

function readOrigin(value: unknown): StructuredObjectOrigin | null {
  const record = getRecord(value);

  if (Object.keys(record).length === 0) {
    return null;
  }

  return {
    streamId: readString(record.streamId),
    hostPage: readString(record.hostPage),
    hostMessageId: readString(record.hostMessageId),
    sentAt: readString(record.sentAt),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeActionId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '-');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
