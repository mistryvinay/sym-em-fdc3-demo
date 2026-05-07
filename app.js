import { EXCEPTIONS } from "./demo-data.js";
import {
  buildSymphonyMessage,
  buildSendOptions
} from "./message-builder.js";
import {
  ensureSdkScript,
  registerGlobalSdkHook,
  renderEmbeddedChat
} from "./symphony-client.js";

const STORAGE_KEY = "sym-em-fdc3-demo.config";
const CHAT_CONTAINER_ID = "ecp-chat";
const CHAT_CONTAINER_SELECTOR = `#${CHAT_CONTAINER_ID}`;

const state = {
  sdkReady: false,
  loadingSdk: false,
  renderingSdk: false,
  interopRegistered: false,
  userInteractionHandlerRegistered: false,
  activeStreamId: "",
  lastRow: EXCEPTIONS[0],
  eventCount: 0
};

const handledActionIds = new Set();

const elements = {
  configForm: document.querySelector("#configForm"),
  podUrl: document.querySelector("#podUrl"),
  partnerId: document.querySelector("#partnerId"),
  streamId: document.querySelector("#streamId"),
  themeMode: document.querySelector("#themeMode"),
  loginMode: document.querySelector("#loginMode"),
  loadChatButton: document.querySelector("#loadChatButton"),
  exceptionTable: document.querySelector("#exceptionTable"),
  sdkDot: document.querySelector("#sdkDot"),
  sdkStatus: document.querySelector("#sdkStatus"),
  ecpChat: document.querySelector("#ecp-chat"),
  eventTableBody: document.querySelector("#eventTableBody"),
  clearLogButton: document.querySelector("#clearLogButton")
};

seedConfigFromQueryString();
restoreConfig();
renderTable();
renderEmptyLog();
bindEvents();
registerGlobalSdkHook(async () => {
  setSdkStatus("SDK loaded", "ready");
  await renderChat();
});

function bindEvents() {
  elements.configForm.addEventListener("submit", (event) => {
    event.preventDefault();
    persistConfig();
    loadEmbeddedMode();
  });

  elements.clearLogButton.addEventListener("click", () => {
    state.eventCount = 0;
    elements.eventTableBody.replaceChildren();
    renderEmptyLog();
  });
}

function seedConfigFromQueryString() {
        const params = new URLSearchParams(window.location.search);
        const queryConfig = {
          podUrl: params.get("pod") || params.get("podUrl"),
          partnerId: params.get("partnerId"),
          streamId: params.get("streamId"),
          themeMode: params.get("theme") || params.get("themeMode"),
          loginMode: params.get("login") || params.get("loginMode")
        };

        Object.entries(queryConfig).forEach(([key, value]) => {
          if (value && elements[key]) {
            elements[key].value = value;
          }
        });
      }

    function restoreConfig() {
        const rawConfig = localStorage.getItem(STORAGE_KEY);
        if (!rawConfig) {
          return;
        }

        try {
          const config = JSON.parse(rawConfig);
          Object.entries(config).forEach(([key, value]) => {
            if (!elements[key] || elements[key].value) {
              return;
            }
            elements[key].value = value;
          });
        } catch (error) {
          logEvent("config.restore.failed", { message: error.message });
        }
      }

function persistConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readConfig()));
}

function readConfig() {
  return {
    podUrl: normalizePodUrl(elements.podUrl.value),
    partnerId: elements.partnerId.value.trim(),
    streamId: elements.streamId.value.trim(),
    themeMode: elements.themeMode.value,
    loginMode: elements.loginMode.value
  };
}

function normalizePodUrl(value) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function renderTable() {
  const rows = EXCEPTIONS.map((item, index) => {
          const row = document.createElement("tr");
          row.tabIndex = 0;
          row.dataset.id = item.id;
          row.setAttribute("aria-selected", String(index === 0));
          row.innerHTML = `
            <td class="mono">${escapeHtml(item.id)}</td>
            <td>${escapeHtml(item.counterparty)}</td>
            <td class="amount">${escapeHtml(item.amount)}</td>
            <td>${escapeHtml(item.cutoff)}</td>
            <td><span class="badge ${item.riskClass}">${escapeHtml(item.risk)}</span></td>
            <td>${escapeHtml(item.action)}</td>
          `;

          row.addEventListener("click", () => selectAndSend(item));
          row.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectAndSend(item);
            }
          });

          return row;
        });

  elements.exceptionTable.replaceChildren(...rows);
}

async function selectAndSend(row) {
  state.lastRow = row;
  setSelectedRow(row.id);

  const payload = buildSymphonyMessage(row);
  const options = buildSendOptions({
    streamId: readConfig().streamId,
    activeStreamId: state.activeStreamId
  });
  const preparedPayload = {
    messageId: payload.metadata.messageId,
    message: payload.message,
    options
  };

  logEvent("message.prepared", preparedPayload);

  if (canUseSymphony()) {
    await sendWithSymphony(payload.message, options);
    return;
  }

  logEvent("message.skipped", {
    reason: "Load the Symphony Embedded Mode SDK before sending a row to chat.",
    messageId: payload.metadata.messageId
  });
}

function setSelectedRow(id) {
  elements.exceptionTable.querySelectorAll("tr").forEach((row) => {
    row.setAttribute("aria-selected", String(row.dataset.id === id));
  });
}

async function sendWithSymphony(message, options) {
  try {
    const result = await window.symphony.sendMessage(message, options);
    if (result && result.error) {
      logEvent("message.failed", result);
      return;
    }

    logEvent("message.sent", result || { status: "resolved without response body" });
  } catch (error) {
    logEvent("message.failed", serializeError(error));
  }
}

function canUseSymphony() {
  return Boolean(window.symphony && typeof window.symphony.sendMessage === "function");
}

async function loadEmbeddedMode() {
        const { podUrl, partnerId, streamId } = readConfig();

        if (!podUrl || !partnerId) {
          setSdkStatus("Setup required", "pending");
          logEvent("sdk.skipped", {
            reason: "Pod URL and Partner ID are required before loading the Embedded Mode SDK."
          });
          return;
        }

        if (!streamId) {
          setSdkStatus("Stream required", "pending");
          logEvent("sdk.skipped", {
            reason: "A Stream ID is required so Embedded Mode knows which chat to load."
          });
          elements.streamId.focus();
          return;
        }

        if (window.symphony && typeof window.symphony.render === "function") {
          await renderChat();
          return;
        }

        await ensureSdkScript({
          podUrl,
          partnerId,
          state,
          setLoadButtonBusy,
          setSdkStatus,
          logEvent
        });
      }

async function renderChat() {
  const { streamId, themeMode, loginMode } = readConfig();
  await renderEmbeddedChat({
    streamId,
    themeMode,
    loginMode,
    containerId: CHAT_CONTAINER_ID,
    containerSelector: CHAT_CONTAINER_SELECTOR,
    containerElement: elements.ecpChat,
    state,
    setLoadButtonBusy,
    setSdkStatus,
    logEvent,
    serializeError,
    onInteropAction: handleInteropAction
  });

  if (state.activeStreamId && !elements.streamId.value.trim()) {
    elements.streamId.value = state.activeStreamId;
  }
}

function handleInteropAction(intent, context) {
  const actionId = context && context.id && context.id.actionId;
  if (actionId && handledActionIds.has(actionId)) {
    logEvent("fdc3.action.duplicateIgnored", {
      intent,
      actionId,
      activeStreamId: state.activeStreamId || readConfig().streamId || null,
      ignoredAt: new Date().toISOString()
    });
    return;
  }

  if (actionId) {
    handledActionIds.add(actionId);
  }

  logEvent("fdc3.action.clicked", {
    intent,
    context,
    activeStreamId: state.activeStreamId || readConfig().streamId || null,
    receivedAt: new Date().toISOString()
  });
}

function renderEmptyLog() {
        if (elements.eventTableBody.children.length > 0) {
          return;
        }

        elements.eventTableBody.innerHTML = `
          <tr class="empty-events">
            <td colspan="6">
              <strong>No notifications logged</strong><br>
              FDC3 action callbacks appear here.
            </td>
          </tr>
        `;
      }

    function logEvent(type, payload) {
        const empty = elements.eventTableBody.querySelector(".empty-events");
        if (empty) {
          empty.remove();
        }

        state.eventCount += 1;
        const event = {
          sequence: state.eventCount,
          type,
          payload,
          timestamp: new Date().toISOString()
        };

        const rowId = `event-${event.sequence}`;
        const summaryRow = document.createElement("tr");
        const detailRow = document.createElement("tr");
        const level = getEventLevel(type);

        summaryRow.className = "event-summary-row";
        detailRow.className = "event-detail-row";
        detailRow.hidden = true;

        summaryRow.innerHTML = `
          <td>
            <button class="event-row-button" type="button" aria-expanded="false" aria-controls="${rowId}">+</button>
          </td>
          <td>
            <button class="event-copy-button" type="button" aria-label="Copy ${escapeHtml(type)} event">Copy</button>
          </td>
          <td><span class="event-level ${level.className}">${escapeHtml(level.label)}</span></td>
          <td class="mono">${escapeHtml(type)}</td>
          <td>${escapeHtml(new Date(event.timestamp).toLocaleTimeString())}</td>
          <td><div class="event-preview">${escapeHtml(buildEventPreview(payload))}</div></td>
        `;
        detailRow.innerHTML = `
          <td id="${rowId}" class="event-detail-cell" colspan="6">
            <pre>${escapeHtml(JSON.stringify(event, null, 2))}</pre>
          </td>
        `;

        const toggleButton = summaryRow.querySelector(".event-row-button");
        const copyButton = summaryRow.querySelector(".event-copy-button");
        toggleButton.addEventListener("click", () => {
          const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";
          toggleButton.setAttribute("aria-expanded", String(!isExpanded));
          toggleButton.textContent = isExpanded ? "+" : "-";
          detailRow.hidden = isExpanded;
        });
        copyButton.addEventListener("click", async () => {
          const originalText = copyButton.textContent;
          try {
            await writeClipboard(JSON.stringify(event, null, 2));
            copyButton.textContent = "Copied";
          } catch (error) {
            copyButton.textContent = "Failed";
          } finally {
            window.setTimeout(() => {
              copyButton.textContent = originalText;
            }, 1200);
          }
        });

        elements.eventTableBody.prepend(detailRow);
        elements.eventTableBody.prepend(summaryRow);
      }

    function getEventLevel(type) {
        if (type.includes("failed") || type.includes("blocked") || type.includes("unavailable")) {
          return { label: "error", className: "error" };
        }

        if (type.includes("skipped") || type.includes("required")) {
          return { label: "warn", className: "warn" };
        }

        return { label: "info", className: "" };
      }

    function buildEventPreview(payload) {
        if (!payload) {
          return "";
        }

        if (typeof payload === "string") {
          return payload;
        }

        const interestingKeys = ["intent", "messageId", "streamId", "activeStreamId", "reason", "status"];
        const preview = interestingKeys
          .filter((key) => payload[key] !== undefined && payload[key] !== null)
          .map((key) => `${key}: ${String(payload[key])}`)
          .join(" | ");

        if (payload.error && payload.error.message) {
          return `error: ${payload.error.message}`;
        }

        return preview || JSON.stringify(payload);
      }

    function setSdkStatus(label, stateName) {
        elements.sdkStatus.textContent = label;
        elements.sdkDot.classList.toggle("ready", stateName === "ready");
        elements.sdkDot.classList.toggle("error", stateName === "error");
      }

    function setLoadButtonBusy(isBusy) {
        elements.loadChatButton.disabled = isBusy;
        elements.loadChatButton.textContent = isBusy ? "Loading..." : "Load Chat";
      }

async function writeClipboard(value) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return;
  }

  throw new Error("Clipboard API is unavailable in this browser context.");
}

    function serializeError(error) {
        if (!error) {
          return { message: "Unknown error" };
        }

        return {
          name: error.name,
          message: error.message,
          data: error.data || null,
          stack: error.stack || null
        };
      }

function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }
