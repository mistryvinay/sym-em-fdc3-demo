import test from "node:test";
import assert from "node:assert/strict";

import {
  attachActionIntentsToMessage,
  buildActionIntentRequest,
  buildSymphonyBatchMessage,
  buildSymphonyMessage,
  buildSendOptions,
  redactActionTokens
} from "../message-builder.js";

const sampleRow = {
  id: "PAY-10482",
  counterparty: "Acme Treasury",
  amount: "$4,500,000",
  cutoff: "14:00 LDN",
  owner: "Taylor",
  instrument: "USD Wire",
  action: "Escalate to treasury ops",
  risk: "High",
  settlementDate: "2026-05-20",
  reason: "Funding confirmation still pending"
};

test("buildSymphonyMessage creates a wrapped structured object payload", () => {
  const result = buildSymphonyMessage(sampleRow, {
    streamId: "stream-123",
    hostPage: "https://localhost:4000/index.html"
  });
  const entity = result.message.entities[result.metadata.entityId];
  const messageText = result.message.text["text/markdown"];

  assert.equal(entity.type, "fdc3.symphonyEntity");
  assert.equal(entity.data.type, "com.mistryvinay.treasury.exception");
  assert.equal(entity.data.details.recommendedAction, sampleRow.action);
  assert.equal(entity.data.origin.hostMessageId, result.metadata.messageId);
  assert.equal(entity.data.origin.streamId, "stream-123");
  assert.match(messageText, /^\*\*Treasury exception PAY-10482: Escalate to treasury ops\*\*/);
  assert.match(messageText, /data-entity-id=/);
  assert.match(messageText, /Structured object attached/);
  assert.doesNotMatch(messageText, /Open the structured object card in Symphony/);
  assert.doesNotMatch(messageText, /Acme Treasury \/ \$4,500,000/);
});

test("buildSymphonyBatchMessage preserves all rows and generates actions per item", () => {
  const result = buildSymphonyBatchMessage([sampleRow, { ...sampleRow, id: "PAY-10483" }], {
    hostPage: "https://localhost:4000/"
  });
  const entity = result.message.entities[result.metadata.entityId];

  assert.equal(result.metadata.rowCount, 2);
  assert.equal(entity.data.items.length, 2);
  assert.equal(entity.data.actions.length, 4);
  assert.match(entity.data.header.title, /Treasury exception batch/);
});

test("structured object actions can be secured with one-time action intents", () => {
  const result = buildSymphonyMessage(sampleRow, {
    streamId: "stream-123",
    hostPage: "https://localhost:4000/index.html"
  });
  const request = buildActionIntentRequest(result);

  assert.equal(request.messageId, result.metadata.messageId);
  assert.equal(request.entityId, result.metadata.entityId);
  assert.equal(request.actions.length, 2);
  assert.deepEqual(
    request.actions.map((action) => action.actionId),
    ["acknowledge-PAY-10482", "escalate-PAY-10482"]
  );

  attachActionIntentsToMessage(result, {
    expiresAt: "2026-06-24T10:00:00.000Z",
    intents: [
      {
        exceptionId: "PAY-10482",
        actionIntentId: "intent-1",
        actionToken: "secret-token",
        allowedActionIds: ["acknowledge-PAY-10482", "escalate-PAY-10482"]
      }
    ]
  });

  const entity = result.message.entities[result.metadata.entityId];

  assert.equal(entity.data.actions.every((action) => action.actionIntentId === "intent-1"), true);
  assert.equal(entity.data.actions.every((action) => action.actionToken === "secret-token"), true);
  assert.equal(entity.data.details.actionToken, undefined);

  const redacted = redactActionTokens(result.message);
  const serializedRedacted = JSON.stringify(redacted);

  assert.equal(serializedRedacted.includes("secret-token"), false);
  assert.equal(serializedRedacted.includes("[redacted]"), true);
});

test("buildSendOptions prefers explicit stream ids and falls back to active chat", () => {
  assert.deepEqual(buildSendOptions({ streamId: "stream-a", activeStreamId: "stream-b" }), {
    mode: "blast",
    streamIds: ["stream-a"]
  });

  assert.deepEqual(buildSendOptions({ streamId: "", activeStreamId: "stream-b" }), {
    mode: "blast",
    streamIds: ["stream-b"]
  });
});
