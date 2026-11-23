import { buildSendOptions } from "../../message-builder.js";
import { ensureSdkScript, registerGlobalSdkHook, renderEmbeddedChat } from "../../symphony-client.js";
import { buildChartMessage, buildInstrumentMessage, getDemoContext } from "./messages.js";

const chat = document.querySelector("#native-fdc3-chat");
const form = document.querySelector("#setup");
const fields = document.querySelector("#setup-fields");
const loadChat = document.querySelector("#load-chat");
const sdkStatus = document.querySelector("#sdk-status");
const sendChart = document.querySelector("#send-chart");
const sendInstrument = document.querySelector("#send-instrument");
const actionStatus = document.querySelector("#action-status");
const interopStatus = document.querySelector("#interop-status");
const fdc3Events = document.querySelector("#fdc3-events");
const noFdc3Events = document.querySelector("#no-fdc3-events");
const diagnostics = document.querySelector("#diagnostics");

const state = { sdkReady: false, loadingSdk: false, renderingSdk: false };
const events = [];
let streamId;

registerGlobalSdkHook(renderChat);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.loadingSdk || state.renderingSdk || state.sdkReady) return;

  if (streamId && window.symphony) {
    void renderChat();
    return;
  }

  const config = new FormData(form);
  const podUrl = config.get("pod").trim();
  const partnerId = config.get("partnerId").trim();
  streamId = config.get("streamId").trim();

  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]+$/i.test(podUrl) || !streamId) {
    setSdkStatus("Enter a pod hostname and Stream ID.", "error");
    return;
  }

  if (window.symphony) {
    void renderChat();
    return;
  }

  document.querySelector("#symphony-ecm-sdk")?.remove();
  void ensureSdkScript({ podUrl, partnerId, state, setLoadButtonBusy, setSdkStatus, logEvent });
});

sendChart.addEventListener("click", () => sendMessage(buildChartMessage()));
sendInstrument.addEventListener("click", () => sendMessage(buildInstrumentMessage()));

async function renderChat() {
  if (!streamId || state.renderingSdk || state.sdkReady) return;

  setLoadButtonBusy(true);
  setSdkStatus("Opening chat…");
  await renderEmbeddedChat({
    streamId,
    themeMode: "light",
    loginMode: "iframe",
    // Allow time to complete a live sign-in or an in-frame prompt.
    renderTimeoutMs: 120_000,
    containerId: chat.id,
    containerSelector: `#${chat.id}`,
    containerElement: chat,
    state,
    setLoadButtonBusy,
    setSdkStatus,
    logEvent,
    serializeError
  });

  if (state.sdkReady) {
    const canSend = typeof window.symphony.sendMessage === "function";
    logEvent("Host features", {
      sendMessage: canSend,
      fdc3RaiseIntent: typeof window.fdc3?.raiseIntent === "function"
    });
    await registerHostCallback();
    sendChart.disabled = !canSend;
    sendInstrument.disabled = !canSend;
  }
}

async function sendMessage(message) {
  sendChart.disabled = true;
  sendInstrument.disabled = true;
  actionStatus.value = "Complete the send dialog in Symphony.";
  const options = buildSendOptions({ streamId });
  logEvent("SDK request", { message, options });

  try {
    const result = await window.symphony.sendMessage(message, options);
    logEvent("SDK response", result);
    if (result?.error) throw result.error;

    actionStatus.value = result?.messages?.some((item) => item?.messageId)
      ? "Sent. Click a button in the delivered message."
      : "SDK returned no message ID. Check chat for delivery.";
  } catch (error) {
    actionStatus.value = "Send failed. See diagnostics.";
    logEvent("Send error", serializeError(error));
  } finally {
    sendChart.disabled = false;
    sendInstrument.disabled = false;
  }
}

async function registerHostCallback() {
  const sdk = window.symphony;
  const register = sdk.registerInterop ?? sdk.registerinterop;
  if (typeof register !== "function") {
    interopStatus.value = "Click events are unavailable in this SDK. Check the Embedded Mode setup.";
    logEvent("Host callback unavailable");
    return;
  }

  interopStatus.value = "Enabling chat button events…";
  try {
    const result = await register.call(sdk, (intent, context) => {
      void handleHostClick(intent, context);
    });
    if (result?.error) throw result.error;

    interopStatus.value = typeof window.fdc3?.raiseIntent === "function"
      ? "Chat button clicks can open matching desktop apps."
      : "Chat button clicks appear here. Opening desktop apps requires an FDC3 desktop agent.";
    logEvent("Host callback registered", result);
  } catch (error) {
    interopStatus.value = "Couldn’t enable chat button events. See SDK diagnostics.";
    logEvent("Host callback error", serializeError(error));
  }
}

async function handleHostClick(intent, context) {
  logEvent("Host callback received", { intent, contextType: context?.type });
  const demoContext = getDemoContext(intent, context);
  const resultCell = addFdc3Event(intent, context?.type, demoContext);
  if (!demoContext) return;

  const agent = window.fdc3;
  if (typeof agent?.raiseIntent !== "function") {
    resultCell.textContent = "Received · no desktop agent";
    logEvent("Host FDC3 unavailable", { intent });
    return;
  }

  resultCell.textContent = "Finding desktop app…";
  try {
    const resolution = await agent.raiseIntent(intent, demoContext);
    const appId = resolution?.source?.appId;
    resultCell.textContent = appId ? `Routed to ${appId}` : "Routed to desktop app";
    logEvent("Host FDC3 intent resolved", { intent, source: resolution?.source });
  } catch (error) {
    resultCell.textContent = "Desktop routing failed";
    logEvent("Host FDC3 intent failed", { intent, ...serializeError(error) });
  }
}

function addFdc3Event(intent, contextType, demoContext) {
  noFdc3Events.remove();
  const row = fdc3Events.insertRow(0);
  const now = new Date();
  const time = document.createElement("time");
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  row.insertCell().append(time);
  row.insertCell().textContent = intent || "Unknown";

  const contextCell = row.insertCell();
  contextCell.textContent = contextType || "Unknown";
  if (demoContext) {
    const identifier = document.createElement("span");
    identifier.className = "event-context-id";
    identifier.textContent = Object.values(demoContext.id).join(", ");
    contextCell.append(identifier);
  }

  const resultCell = row.insertCell();
  resultCell.textContent = "Received";
  if (fdc3Events.rows.length > 20) fdc3Events.deleteRow(-1);
  return resultCell;
}

function setLoadButtonBusy(busy) {
  fields.disabled = busy || Boolean(window.symphony);
  loadChat.disabled = busy || state.sdkReady;
}

function setSdkStatus(message, tone) {
  sdkStatus.value = message;
  sdkStatus.dataset.tone = tone || "";
}

function logEvent(label, data) {
  const entry = data === undefined ? label : `${label}\n${JSON.stringify(data, null, 2)}`;
  events.unshift(`${new Date().toISOString()}  ${entry}`);
  if (events.length > 20) events.pop();
  diagnostics.textContent = events.join("\n\n");
  diagnostics.scrollTop = 0;
}

function serializeError(error) {
  return { name: error?.name || error?.type, message: error?.message || String(error) };
}
