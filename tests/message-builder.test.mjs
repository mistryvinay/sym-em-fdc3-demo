import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSymphonyBatchMessage,
  buildSymphonyMessage,
  buildSendOptions
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

  assert.equal(entity.type, "fdc3.symphonyEntity");
  assert.equal(entity.data.type, "com.mistryvinay.treasury.exception");
  assert.equal(entity.data.details.recommendedAction, sampleRow.action);
  assert.equal(entity.data.origin.hostMessageId, result.metadata.messageId);
  assert.equal(entity.data.origin.streamId, "stream-123");
  assert.match(result.message.text["text/markdown"], /Structured object attached/);
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