export function isTrustedAuditOrigin(origin, trustedOrigins) {
  return Boolean(origin && trustedOrigins instanceof Set && trustedOrigins.has(origin));
}

export function resolveAuditFeedCredentials(requestUrl, extensionAppOrigin) {
  return requestUrl.origin === extensionAppOrigin ? "omit" : "include";
}

export function isStructuredObjectAuditEnvelope(value, expectedSource, expectedType) {
  return Boolean(
    value &&
      value.source === expectedSource &&
      value.type === expectedType &&
      value.payload
  );
}

export function resolveAuditHostMessageId(auditEvent) {
  return auditEvent?.origin?.hostMessageId || auditEvent?.messageId || null;
}

export function isDuplicateAuditEvent(runtimeState, auditEvent) {
  const eventId = auditEvent?.auditEventId;

  if (!eventId) {
    return false;
  }

  if (runtimeState.processedAuditEventIds.has(eventId)) {
    return true;
  }

  runtimeState.processedAuditEventIds.add(eventId);
  return false;
}

export function applyAuditStateChangeToState(runtimeState, auditPayload) {
  if (!auditPayload || typeof auditPayload !== "object") {
    return null;
  }

  const auditEvent = {
    ...auditPayload,
    receivedAt: auditPayload.receivedAt || new Date().toISOString()
  };
  const hostMessageId = resolveAuditHostMessageId(auditEvent);
  const deliveryRecord = hostMessageId
    ? runtimeState.deliveryByHostMessageId.get(hostMessageId) || null
    : null;

  runtimeState.auditTrail.unshift(auditEvent);

  if (auditEvent.auditKey) {
    runtimeState.actionState.set(auditEvent.auditKey, {
      status: auditEvent.status,
      action: auditEvent.action,
      exceptionId: auditEvent.exceptionId,
      messageId: auditEvent.messageId,
      hostMessageId,
      deliveryRecord,
      deliveries: deliveryRecord?.deliveries || [],
      intendedStreamId: deliveryRecord?.intendedStreamId || auditEvent.origin?.streamId || null,
      actor: auditEvent.actor,
      occurredAt: auditEvent.occurredAt,
      auditEventId: auditEvent.auditEventId
    });
  }

  return {
    auditEvent,
    hostMessageId,
    deliveryRecord
  };
}