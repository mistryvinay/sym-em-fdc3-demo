import test from "node:test";
import assert from "node:assert/strict";

import { buildChartMessage, buildInstrumentMessage, getDemoContext } from "../examples/native-fdc3-action-buttons/messages.js";

const aaplInstrument = { type: "fdc3.instrument", id: { ticker: "AAPL" } };

test("the chart check contains a cashtag and a matching SDK intent entity", () => {
  const message = buildChartMessage();
  assert.match(message.text["text/markdown"], /\$AAPL/);
  assert.ok(message.text["text/markdown"].includes("§[Chart AAPL](id/chart)"));
  assert.deepEqual(message.entities.chart, {
    type: "fdc3.fdc3Intent",
    data: {
      title: "Chart AAPL",
      intent: "ViewChart",
      context: aaplInstrument
    }
  });
});

test("instrument actions reference distinct SDK entities with standard FDC3 intents", () => {
  const message = buildInstrumentMessage();
  assert.match(message.text["text/markdown"], /\$AAPL/);
  assert.ok(message.text["text/markdown"].includes("§[View AAPL Details](id/instrument) §[View AAPL Orders](id/orders)"));
  assert.deepEqual(message.entities, {
    instrument: {
      type: "fdc3.fdc3Intent",
      data: {
        title: "View AAPL Details",
        intent: "ViewInstrument",
        context: aaplInstrument
      }
    },
    orders: {
      type: "fdc3.fdc3Intent",
      data: {
        title: "View AAPL Orders",
        intent: "ViewOrders",
        context: aaplInstrument
      }
    }
  });
});

test("the host relay forwards only the demo intent and context combinations", () => {
  for (const intent of ["ViewChart", "ViewInstrument", "ViewOrders"]) {
    assert.deepEqual(getDemoContext(intent, { ...aaplInstrument, extra: "ignored" }), aaplInstrument);
    assert.equal(getDemoContext(intent, { ...aaplInstrument, id: { ticker: "MSFT" } }), undefined);
  }
  assert.equal(getDemoContext("ViewOrders", { type: "fdc3.order", id: { ticker: "AAPL" } }), undefined);
  assert.equal(getDemoContext("ViewNews", aaplInstrument), undefined);
  assert.equal(getDemoContext("ViewChart", undefined), undefined);
});
