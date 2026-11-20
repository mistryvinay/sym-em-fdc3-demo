import test from "node:test";
import assert from "node:assert/strict";

import { buildChartMessage, buildTradeMessage, getDemoContext } from "../examples/native-fdc3-action-buttons/messages.js";

test("the chart check contains a cashtag and a matching SDK intent entity", () => {
  const message = buildChartMessage();
  assert.match(message.text["text/markdown"], /\$AAPL/);
  assert.ok(message.text["text/markdown"].includes("§[Chart AAPL](id/chart)"));
  assert.deepEqual(message.entities.chart, {
    type: "fdc3.fdc3Intent",
    data: {
      title: "Chart AAPL",
      intent: "ViewChart",
      context: { type: "fdc3.instrument", id: { ticker: "AAPL" } }
    }
  });
});

test("trade actions reference distinct SDK entities and receiver contracts", () => {
  const message = buildTradeMessage();
  assert.ok(message.text["text/markdown"].includes("§[View Trade](id/trade) §[Launch Blotter](id/blotter)"));
  assert.deepEqual(message.entities, {
    trade: {
      type: "fdc3.fdc3Intent",
      data: {
        title: "View Trade",
        intent: "com.example.ViewTrade",
        context: { type: "com.example.trade", id: { tradeId: "DEMO-TRADE-001" } }
      }
    },
    blotter: {
      type: "fdc3.fdc3Intent",
      data: {
        title: "Launch Blotter",
        intent: "com.example.LaunchBlotter",
        context: { type: "com.example.blotter", id: { blotterId: "DEMO-BLOTTER-001" } }
      }
    }
  });
});

test("the host relay forwards only the demo intent and context combinations", () => {
  const chartContext = { type: "fdc3.instrument", id: { ticker: "AAPL" } };
  assert.deepEqual(getDemoContext("ViewChart", { ...chartContext, extra: "ignored" }), chartContext);
  assert.equal(getDemoContext("ViewChart", { ...chartContext, id: { ticker: "MSFT" } }), undefined);
  assert.equal(getDemoContext("ViewInstrument", chartContext), undefined);
  assert.equal(getDemoContext("ViewChart", undefined), undefined);
});
