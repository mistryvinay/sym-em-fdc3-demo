import * as ADK from '@symphony-ui/adk';

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
  recommendedAction: string;
  risk: string;
  settlementDate: string;
  reason: string;
};
type StructuredObjectAction = {
  id: string;
  label: string;
  type: string;
  exceptionId: string;
  actionIntentId: string | null;
  actionToken: string | null;
  allowedActionIds: string[];
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
const SECRET_FIELD_NAMES = new Set(['actionToken', 'tokenHash']);
const processedActions = new Set<string>();
type ControllerWindow = Window & typeof globalThis & {
  __symEmRendererRegistered?: boolean;
};

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
  const currentWindow = getControllerWindow();

  if (currentWindow.__symEmRendererRegistered) {
    return;
  }

  const onRender = (entityData: StructuredObjectData) => renderTreasuryException(config, entityData);
  const onAction = (actionId: string, actionPayload?: StructuredActionPayload) => {
    void publishAuditEvent({
      config,
      actionId,
      actionPayload,
      viewer,
    });
  };

  ADK.messages.registerRenderer(SHARED_MESSAGE_SYMPHONY_ENTITY_TYPE, onRender, onAction);
  currentWindow.__symEmRendererRegistered = true;

  window.console.info('structured-object.renderer.registered', {
    rendererType: SHARED_MESSAGE_SYMPHONY_ENTITY_TYPE,
    payloadType: config.objectType,
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
  const nestedPayloadData = getRecord(payloadData.data);
  const extraData = getRecord(actionPayload?.extraData);
  const dataSources = [nestedPayloadData, payloadData, extraData];
  const exceptionId = readStringFromRecords(dataSources, 'exceptionId');
  const messageId = readStringFromRecords(dataSources, 'messageId');
  const entityId = readStringFromRecords(dataSources, 'entityId');
  const origin = readOriginFromRecords(dataSources);
  const actionIntentId = readStringFromRecords(dataSources, 'actionIntentId');
  const actionToken = readStringFromRecords(dataSources, 'actionToken');
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
      status: duplicate ? 'clientDuplicate' : 'pending',
      actionId,
      action: readStringFromRecords(dataSources, 'action') || actionId,
      label: readStringFromRecords(dataSources, 'label') || actionId,
      actionIntentId,
      messageId,
      entityId,
      exceptionId,
      origin,
      actor: viewer,
      occurredAt: new Date().toISOString(),
      actionPayload: redactActionSecrets(actionPayload || null),
    },
  };
  const endpointAuditEvent = {
    ...auditEvent,
    payload: {
      ...auditEvent.payload,
      actionToken,
    },
  };

  window.console.info('structured-object.action.audit', auditEvent.payload);
  postAuditEventToHost(auditEvent, origin);

  return publishAuditEventToEndpoint(config.auditEndpointUrl, endpointAuditEvent);
}

function postAuditEventToHost(
  auditEvent: Record<string, unknown>,
  origin: StructuredObjectOrigin | null,
): void {
  const targetOrigin = resolveAuditPostMessageTarget(origin);

  if (!targetOrigin || !window.top || window.top === window) {
    if (window.top && window.top !== window) {
      window.console.warn('structured-object.action.audit.postMessage.skipped', {
        reason: 'Unable to resolve host page origin from structured object payload.',
        origin,
      });
    }
    return;
  }

  window.top.postMessage(auditEvent, targetOrigin);
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
        'Accept': 'application/json',
      },
      body: JSON.stringify(auditEvent),
    });
    const responseBody = await readEndpointJson(response);

    if (!response.ok) {
      window.console.warn('structured-object.action.audit.endpoint.failed', {
        status: response.status,
        statusText: response.statusText,
        actionStatus: readString(responseBody?.status),
        reason: readString(responseBody?.reason),
      });
      return;
    }

    window.console.info('structured-object.action.audit.endpoint.sent', {
      status: response.status,
      actionStatus: readString(responseBody?.status),
    });
  } catch (error) {
    window.console.warn('structured-object.action.audit.endpoint.failed', error);
  }
}

async function readEndpointJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return getRecord(await response.json());
  } catch {
    return null;
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

  const entityId = readString(data.entityId) || readString(data.id) || null;
  const messageId = readString(data.messageId) || null;
  const origin = readOrigin(data.origin);
  const items = readStructuredItems(data);
  const actions = buildRendererActions(data, items, entityId, messageId, origin);

  return {
    template: [
      '<entity>',
      renderBatchItems(items, data),
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

function resolveAuditPostMessageTarget(origin: StructuredObjectOrigin | null): string | null {
  const hostPage = origin?.hostPage;

  if (!hostPage) {
    return null;
  }

  try {
    return new URL(hostPage).origin;
  } catch {
    return null;
  }
}

function getControllerWindow(): ControllerWindow {
  return window as ControllerWindow;
}

function renderBatchItems(items: StructuredObjectItem[], data: StructuredObjectData): string {
  return [
    '<table>',
    '<tr>',
    '<th>Exception</th>',
    '<th>Recommended action</th>',
    '<th>Counterparty</th>',
    '<th>Amount</th>',
    '<th>Cutoff</th>',
    '<th>Risk</th>',
    '<th>Actions</th>',
    '</tr>',
    items.map((item) => renderBatchRow(item, data)).join(''),
    '</table>',
  ].join('');
}

function renderBatchRow(item: StructuredObjectItem, data: StructuredObjectData): string {
  const actions = readActionsForItem(data, item);

  return [
    '<tr>',
    `<td><b>${escapeXml(item.exceptionId)}</b></td>`,
    `<td>${escapeXml(item.recommendedAction)}</td>`,
    `<td>${escapeXml(item.counterparty)}</td>`,
    `<td>${escapeXml(item.amount)}</td>`,
    `<td>${escapeXml(item.cutoff)}</td>`,
    `<td>${escapeXml(item.risk)}</td>`,
    `<td>${actions.map((action) => (
      `<action id="${escapeXml(action.id)}" class="tk-button ${buttonClassForAction(action.type)} tk-button--small" />`
    )).join('')}</td>`,
    '</tr>',
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
          actionIntentId: action.actionIntentId,
          actionToken: action.actionToken,
          allowedActionIds: action.allowedActionIds,
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
    recommendedAction: readString(record.recommendedAction) || readString(record.requiredAction) || 'Review',
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
      actionIntentId: readString(action.actionIntentId),
      actionToken: readString(action.actionToken),
      allowedActionIds: readStringArray(action.allowedActionIds),
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
      actionIntentId: null,
      actionToken: null,
      allowedActionIds: [],
    },
    {
      id: `escalate-${normalizeActionId(item.exceptionId)}`,
      label: 'Escalate',
      type: 'escalate',
      exceptionId: item.exceptionId,
      actionIntentId: null,
      actionToken: null,
      allowedActionIds: [],
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

function readStringFromRecords(records: Record<string, unknown>[], fieldName: string): string | null {
  for (const record of records) {
    const value = readString(record[fieldName]);

    if (value) {
      return value;
    }
  }

  return null;
}

function readOriginFromRecords(records: Record<string, unknown>[]): StructuredObjectOrigin | null {
  for (const record of records) {
    const origin = readOrigin(record.origin);

    if (origin) {
      return origin;
    }
  }

  return null;
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

function redactActionSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactActionSecrets(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_FIELD_NAMES.has(key))
      .map(([key, child]) => [key, redactActionSecrets(child)]),
  );
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
