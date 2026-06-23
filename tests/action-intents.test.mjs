import test from "node:test";
import assert from "node:assert/strict";

import {
  createActionIntentStore,
  hashActionToken,
  sanitizeAuditEnvelope
} from "../action-intents.js";

const intentRequest = {
  messageId: "message-1",
  entityId: "entity-1",
  origin: {
    streamId: "stream-1"
  },
  actions: [
    {
      actionId: "acknowledge-PAY-10482",
      action: "acknowledge",
      label: "Acknowledge",
      exceptionId: "PAY-10482"
    },
    {
      actionId: "escalate-PAY-10482",
      action: "escalate",
      label: "Escalate",
      exceptionId: "PAY-10482"
    }
  ]
};

function createDeterministicStore({ ttlMs = 1_000 } = {}) {
  let currentTime = new Date("2026-06-23T10:00:00.000Z");
  let id = 0;
  let token = 0;
  const store = createActionIntentStore({
    ttlMs,
    now: () => currentTime,
    generateId: () => `intent-${++id}`,
    generateToken: () => `token-${++token}`
  });

  return {
    store,
    advance(ms) {
      currentTime = new Date(currentTime.getTime() + ms);
    }
  };
}

function createAcceptedPayload(intent, overrides = {}) {
  return {
    auditEventId: "event-1",
    actionIntentId: intent.actionIntentId,
    actionToken: intent.actionToken,
    actionId: "acknowledge-PAY-10482",
    messageId: "message-1",
    entityId: "entity-1",
    exceptionId: "PAY-10482",
    ...overrides
  };
}

test("createIntents groups actions by exception and returns opaque one-time tokens", () => {
  const { store } = createDeterministicStore();
  const result = store.createIntents(intentRequest);

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 201);
  assert.equal(result.response.expiresAt, "2026-06-23T10:00:01.000Z");
  assert.equal(result.response.intents.length, 1);
  assert.deepEqual(result.response.intents[0], {
    exceptionId: "PAY-10482",
    actionIntentId: "intent-1",
    actionToken: "token-1",
    allowedActionIds: ["acknowledge-PAY-10482", "escalate-PAY-10482"]
  });
  assert.notEqual(hashActionToken("token-1"), "token-1");
});

test("consumeAuditPayload accepts one valid action and rejects later alternatives", () => {
  const { store } = createDeterministicStore();
  const intent = store.createIntents(intentRequest).response.intents[0];

  const accepted = store.consumeAuditPayload(createAcceptedPayload(intent));
  const replayedAlternative = store.consumeAuditPayload(createAcceptedPayload(intent, {
    auditEventId: "event-2",
    actionId: "escalate-PAY-10482"
  }));

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.status, "accepted");
  assert.equal(replayedAlternative.accepted, false);
  assert.equal(replayedAlternative.statusCode, 409);
  assert.equal(replayedAlternative.status, "already_actioned");
});

test("consumeAuditPayload rejects wrong token, mismatched action, and expired intents", () => {
  const wrongToken = createDeterministicStore();
  const wrongTokenIntent = wrongToken.store.createIntents(intentRequest).response.intents[0];
  const wrongTokenResult = wrongToken.store.consumeAuditPayload(createAcceptedPayload(wrongTokenIntent, {
    actionToken: "not-the-token"
  }));
  assert.equal(wrongTokenResult.accepted, false);
  assert.equal(wrongTokenResult.statusCode, 403);

  const wrongAction = createDeterministicStore();
  const wrongActionIntent = wrongAction.store.createIntents(intentRequest).response.intents[0];
  const wrongActionResult = wrongAction.store.consumeAuditPayload(createAcceptedPayload(wrongActionIntent, {
    actionId: "approve-PAY-10482"
  }));
  assert.equal(wrongActionResult.statusCode, 403);
  assert.equal(wrongActionResult.reason, "action_not_allowed");

  const expired = createDeterministicStore({ ttlMs: 10 });
  const expiredIntent = expired.store.createIntents(intentRequest).response.intents[0];
  expired.advance(11);
  const expiredResult = expired.store.consumeAuditPayload(createAcceptedPayload(expiredIntent));
  assert.equal(expiredResult.statusCode, 410);
  assert.equal(expiredResult.status, "expired");
});

test("consumeAuditPayload rejects malformed payloads before token lookup", () => {
  const { store } = createDeterministicStore();

  assert.equal(store.consumeAuditPayload(null).statusCode, 400);
  assert.equal(store.consumeAuditPayload({}).reason, "auditEventId_required");
});

test("sanitizeAuditEnvelope removes raw action tokens recursively", () => {
  const sanitized = sanitizeAuditEnvelope({
    source: "sym-em-structured-object-extension",
    type: "structured-object.action.audit",
    payload: {
      actionIntentId: "intent-1",
      actionToken: "secret-token",
      actionPayload: {
        data: {
          actionToken: "nested-secret"
        }
      }
    }
  }, {
    status: "accepted"
  });

  const serialized = JSON.stringify(sanitized);

  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes("nested-secret"), false);
  assert.equal(sanitized.payload.status, "accepted");
  assert.equal(sanitized.payload.actionIntentId, "intent-1");
});
