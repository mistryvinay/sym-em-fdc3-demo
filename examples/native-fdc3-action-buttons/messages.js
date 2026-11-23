const AAPL_INSTRUMENT = { type: "fdc3.instrument", id: { ticker: "AAPL" } };

const CHART_ACTIONS = {
  chart: {
    title: "Chart AAPL",
    intent: "ViewChart",
    context: AAPL_INSTRUMENT
  }
};

const INSTRUMENT_ACTIONS = {
  instrument: {
    title: "View AAPL Details",
    intent: "ViewInstrument",
    context: AAPL_INSTRUMENT
  },
  orders: {
    title: "View AAPL Orders",
    intent: "ViewOrders",
    context: AAPL_INSTRUMENT
  }
};

export function buildChartMessage() {
  return buildMessage("**FDC3 connector check**\n\n$AAPL", CHART_ACTIONS);
}

export function buildInstrumentMessage() {
  return buildMessage("**AAPL instrument actions**\n\n$AAPL", INSTRUMENT_ACTIONS);
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
  // Only relay the demo actions defined here, using their canonical context.
  const action = [...Object.values(CHART_ACTIONS), ...Object.values(INSTRUMENT_ACTIONS)].find(
    (candidate) => candidate.intent === intent &&
      candidate.context.type === context?.type &&
      Object.entries(candidate.context.id).every(([key, value]) => context.id?.[key] === value)
  );
  return action && structuredClone(action.context);
}
