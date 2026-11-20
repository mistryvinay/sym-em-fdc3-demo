import { ensureSdkScript, registerGlobalSdkHook, renderEmbeddedChat } from "../../symphony-client.js";
import { buildChartMessage, buildTradeMessage, getDemoContext } from "./messages.js";

const chat = document.querySelector("#native-fdc3-chat");
const form = document.querySelector("#setup");
const fields = document.querySelector("#setup-fields");
const loadChat = document.querySelector("#load-chat");
const sdkStatus = document.querySelector("#sdk-status");
const sendChart = document.querySelector("#send-chart");
const sendTrade = document.querySelector("#send-trade");
const registerInterop = document.querySelector("#register-interop");
const relay = document.querySelector("#relay");
const actionStatus = document.querySelector("#action-status");
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

  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]+$/i.test(podUrl) || !partnerId || !streamId) {
    setSdkStatus("Enter a pod hostname, Partner ID and Stream ID.", "error");
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
sendTrade.addEventListener("click", () => sendMessage(buildTradeMessage()));
registerInterop.addEventListener("click", registerHostCallback);

async function renderChat() {
  if (!streamId) return;

  setLoadButtonBusy(true);
  setSdkStatus("Opening chat…");
  await renderEmbeddedChat({
    streamId,
    themeMode: "light",
    loginMode: "popup",
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
    sendChart.disabled = !canSend;
    sendTrade.disabled = !canSend;
    registerInterop.disabled = false;
    logEvent("Host features", {
      sendMessage: canSend,
      fdc3RaiseIntent: typeof window.fdc3?.raiseIntent === "function"
    });
  }
}

async function sendMessage(message) {
  sendChart.disabled = true;
  sendTrade.disabled = true;
  actionStatus.value = "Complete the send dialog in Symphony.";
  const options = { mode: "blast", streamIds: [streamId], container: `#${chat.id}` };
  logEvent("SDK request", { message, options });

  try {
    const result = await window.symphony.sendMessage(message, options);
    logEvent("SDK response", result);
    if (result?.error) throw result.error;

    actionStatus.value = result?.messages?.some((item) => item?.messageId)
      ? "SDK returned a message ID. Verify the delivered message in chat."
      : "SDK returned no message ID. Check chat for delivery.";
  } catch (error) {
    actionStatus.value = "Send failed. See diagnostics.";
    logEvent("Send error", serializeError(error));
  } finally {
    sendChart.disabled = false;
    sendTrade.disabled = false;
  }
}

async function registerHostCallback() {
  const sdk = window.symphony;
  const register = sdk.registerInterop ?? sdk.registerinterop;
  if (typeof register !== "function") {
    actionStatus.value = "Host interop callback is unavailable. Check the SDK and Embedded Mode plan.";
    return;
  }

  registerInterop.disabled = true;
  actionStatus.value = "Registering host callback…";
  try {
    const result = await register.call(sdk, (intent, context) => {
      void handleHostClick(intent, context);
    });
    if (result?.error) throw result.error;

    relay.disabled = false;
    actionStatus.value = "Host callback registered. Click a delivered button to test it.";
    logEvent("Host callback registered", result);
  } catch (error) {
    registerInterop.disabled = false;
    actionStatus.value = "Host callback registration failed. See diagnostics.";
    logEvent("Host callback error", serializeError(error));
  }
}

async function handleHostClick(intent, context) {
  logEvent("Host callback received", { intent, contextType: context?.type });
  if (!relay.checked) return;

  const demoContext = getDemoContext(intent, context);
  if (!demoContext) return;

  const agent = window.fdc3;
  if (typeof agent?.raiseIntent !== "function") {
    logEvent("Host FDC3 unavailable", { intent });
    return;
  }

  try {
    const resolution = await agent.raiseIntent(intent, demoContext);
    logEvent("Host FDC3 intent resolved", { intent, source: resolution?.source });
  } catch (error) {
    logEvent("Host FDC3 intent failed", { intent, ...serializeError(error) });
  }
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
