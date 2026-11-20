const CONTROL_ACTIONS = {
  chart: {
    title: "Chart AAPL",
    intent: "ViewChart",
    context: { type: "fdc3.instrument", id: { ticker: "AAPL" } }
  }
};

const TRADE_ACTIONS = {
  trade: {
    title: "View Trade",
    intent: "com.example.ViewTrade",
    context: { type: "com.example.trade", id: { tradeId: "DEMO-TRADE-001" } }
  },
  blotter: {
    title: "Launch Blotter",
    intent: "com.example.LaunchBlotter",
    context: { type: "com.example.blotter", id: { blotterId: "DEMO-BLOTTER-001" } }
  }
};

export function buildChartMessage() {
  return buildMessage("**FDC3 connector check**\n\n$AAPL", CONTROL_ACTIONS);
}

export function buildTradeMessage() {
  return buildMessage("**Demo trade actions**", TRADE_ACTIONS);
}

function buildMessage(body, actions) {
  const links = [];
  const entities = {};

  for (const [id, data] of Object.entries(actions)) {
    links.push(`§[${data.title}](id/${id})`);
    entities[id] = { type: "fdc3.fdc3Intent", data: structuredClone(data) };
  }

  return { text: { "text/markdown": `${body}\n\n${links.join(" ")}` }, entities };
}

export function getDemoContext(intent, context) {
  // Only relay the synthetic actions defined here, using their canonical context.
  const action = [...Object.values(CONTROL_ACTIONS), ...Object.values(TRADE_ACTIONS)].find(
    (candidate) => candidate.intent === intent &&
      candidate.context.type === context?.type &&
      Object.entries(candidate.context.id).every(([key, value]) => context.id?.[key] === value)
  );
  return action && structuredClone(action.context);
}
