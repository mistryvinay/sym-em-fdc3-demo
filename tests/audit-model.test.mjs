import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAuditStateChangeToState,
  isDuplicateAuditEvent,
  isStructuredObjectAuditEnvelope,
  isTrustedAuditOrigin,
  resolveAuditFeedCredentials,
  resolveAuditHostMessageId
} from "../audit-model.js";

function createRuntimeState() {
  return {
    processedAuditEventIds: new Set(),
    deliveryByHostMessageId: new Map(),
    auditTrail: [],
    actionState: new Map()
  };
}

test("audit origin trust only accepts the configured extension origin", () => {
  const trustedOrigins = new Set(["https://localhost:4001"]);

  assert.equal(isTrustedAuditOrigin("https://localhost:4001", trustedOrigins), true);
  assert.equal(isTrustedAuditOrigin("null", trustedOrigins), false);
  assert.equal(isTrustedAuditOrigin("https://example.com", trustedOrigins), false);
});

test("resolveAuditFeedCredentials omits credentials for the local extension feed", () => {
  assert.equal(
    resolveAuditFeedCredentials(new URL("https://localhost:4001/audit-feed"), "https://localhost:4001"),
    "omit"
  );
  assert.equal(
    resolveAuditFeedCredentials(new URL("https://api.example.com/audit-feed"), "https://localhost:4001"),
    "include"
  );
});

test("audit replay applies delivery correlation and deduplicates event ids", () => {
  const runtimeState = createRuntimeState();
  runtimeState.deliveryByHostMessageId.set("host-1", {
    intendedStreamId: "stream-1",
    deliveries: [{ symphonyMessageId: "sym-1", streamId: "stream-1" }]
  });

  const auditPayload = {
    auditEventId: "event-1",
    auditKey: "host-1:PAY-10482:acknowledge-PAY-10482",
    action: "acknowledge",
    status: "accepted",
    exceptionId: "PAY-10482",
    messageId: "host-1",
    origin: {
      hostMessageId: "host-1",
      streamId: "stream-1"
    },
    actor: {
      userId: "user-1"
    },
    occurredAt: "2026-05-20T10:00:00.000Z"
  };

  assert.equal(isDuplicateAuditEvent(runtimeState, auditPayload), false);
  assert.equal(isDuplicateAuditEvent(runtimeState, auditPayload), true);

  const applied = applyAuditStateChangeToState(runtimeState, auditPayload);

  assert.equal(resolveAuditHostMessageId(auditPayload), "host-1");
  assert.equal(runtimeState.auditTrail.length, 1);
  assert.equal(applied.hostMessageId, "host-1");
  assert.deepEqual(runtimeState.actionState.get(auditPayload.auditKey)?.deliveries, [
    { symphonyMessageId: "sym-1", streamId: "stream-1" }
  ]);
});

test("structured audit envelope detection requires the expected source and type", () => {
  assert.equal(
    isStructuredObjectAuditEnvelope(
      {
        source: "sym-em-structured-object-extension",
        type: "structured-object.action.audit",
        payload: {}
      },
      "sym-em-structured-object-extension",
      "structured-object.action.audit"
    ),
    true
  );

  assert.equal(
    isStructuredObjectAuditEnvelope(
      {
        source: "other-source",
        type: "structured-object.action.audit",
        payload: {}
      },
      "sym-em-structured-object-extension",
      "structured-object.action.audit"
    ),
    false
  );
});