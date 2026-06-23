import { EXCEPTIONS } from "./demo-data.js";
import {
  buildSymphonyMessage,
  buildSymphonyBatchMessage,
  buildSendOptions,
  buildActionIntentRequest,
  attachActionIntentsToMessage,
  redactActionTokens
} from "./message-builder.js";
import {
  ensureSdkScript,
  registerGlobalSdkHook,
  renderEmbeddedChat
} from "./symphony-client.js";
import {
  applyAuditStateChangeToState,
  isDuplicateAuditEvent,
  isStructuredObjectAuditEnvelope,
  isTrustedAuditOrigin,
  resolveAuditFeedCredentials,
  resolveAuditHostMessageId
} from "./audit-model.js";

const STORAGE_KEY = "sym-em-fdc3-demo.config";
const CHAT_CONTAINER_ID = "ecp-chat";
const CHAT_CONTAINER_SELECTOR = `#${CHAT_CONTAINER_ID}`;
const AUDIT_EVENT_SOURCE = "sym-em-structured-object-extension";
const AUDIT_EVENT_TYPE = "structured-object.action.audit";
const EXTENSION_APP_ORIGIN = "https://localhost:4001";
const EXTENSION_ACTION_INTENTS_URL = `${EXTENSION_APP_ORIGIN}/action-intents`;
const EXTENSION_AUDIT_FEED_URL = `${EXTENSION_APP_ORIGIN}/audit-feed`;
const TRUSTED_AUDIT_ORIGINS = new Set([EXTENSION_APP_ORIGIN]);

const state = {
  sdkReady: false,
  loadingSdk: false,
  renderingSdk: false,
  userInteractionHandlerRegistered: false,
  activeStreamId: "",
  lastRow: EXCEPTIONS[0],
  eventCount: 0,
  auditFeedTimer: null,
  auditFeedLastSequence: 0,
  processedAuditEventIds: new Set(),
  selectedRowIds: new Set(),
  deliveryByHostMessageId: new Map(),
  auditTrail: [],
  actionState: new Map()
};

const elements = {
  configForm: document.querySelector("#configForm"),
  podUrl: document.querySelector("#podUrl"),
  partnerId: document.querySelector("#partnerId"),
  streamId: document.querySelector("#streamId"),
  themeMode: document.querySelector("#themeMode"),
  loginMode: document.querySelector("#loginMode"),
  auditFeedUrl: document.querySelector("#auditFeedUrl"),
  loadChatButton: document.querySelector("#loadChatButton"),
  sendSelectedButton: document.querySelector("#sendSelectedButton"),
  selectedCount: document.querySelector("#selectedCount"),
  selectAllRows: document.querySelector("#selectAllRows"),
  exceptionTable: document.querySelector("#exceptionTable"),
  sdkDot: document.querySelector("#sdkDot"),
  sdkStatus: document.querySelector("#sdkStatus"),
  ecpChat: document.querySelector("#ecp-chat"),
  eventTableBody: document.querySelector("#eventTableBody"),
  clearLogButton: document.querySelector("#clearLogButton")
};

seedConfigFromQueryString();
restoreConfig();
applyDefaultConfig();
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
    state.auditFeedLastSequence = 0;
    state.processedAuditEventIds.clear();
    state.deliveryByHostMessageId.clear();
    state.auditTrail = [];
    state.actionState.clear();
    elements.eventTableBody.replaceChildren();
    renderEmptyLog();
  });

  elements.sendSelectedButton.addEventListener("click", () => {
    sendSelectedRows();
  });

  elements.selectAllRows.addEventListener("change", () => {
    setAllRowsSelected(elements.selectAllRows.checked);
  });

  window.addEventListener("message", handleStructuredObjectAuditMessage);
}

function seedConfigFromQueryString() {
        const params = new URLSearchParams(window.location.search);
        const queryConfig = {
          podUrl: params.get("pod") || params.get("podUrl"),
          partnerId: params.get("partnerId"),
          streamId: params.get("streamId"),
          themeMode: params.get("theme") || params.get("themeMode"),
          loginMode: params.get("login") || params.get("loginMode"),
          auditFeedUrl: params.get("auditFeedUrl")
        };

        Object.entries(queryConfig).forEach(([key, value]) => {
          if (value && elements[key]) {
            elements[key].value = value;
          }
        });
      }

function applyDefaultConfig() {
  const currentValue = elements.auditFeedUrl.value.trim();

  if (!currentValue || isLegacyDefaultAuditFeedUrl(currentValue)) {
    elements.auditFeedUrl.value = buildDefaultAuditFeedUrl();
  }
}

function buildDefaultAuditFeedUrl() {
  return EXTENSION_AUDIT_FEED_URL;
}

function isLegacyDefaultAuditFeedUrl(value) {
  return value === window.location.origin + window.location.pathname;
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
    loginMode: elements.loginMode.value,
    auditFeedUrl: elements.auditFeedUrl.value.trim()
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
            <td class="select-cell">
              <input class="row-select" type="checkbox" aria-label="Select ${escapeHtml(item.id)}">
            </td>
            <td class="mono">${escapeHtml(item.id)}</td>
            <td>${escapeHtml(item.counterparty)}</td>
            <td class="amount">${escapeHtml(item.amount)}</td>
            <td>${escapeHtml(item.cutoff)}</td>
            <td><span class="badge ${item.riskClass}">${escapeHtml(item.risk)}</span></td>
            <td>${escapeHtml(item.action)}</td>
          `;

          const checkbox = row.querySelector(".row-select");
          checkbox.addEventListener("click", (event) => {
            event.stopPropagation();
          });
          checkbox.addEventListener("keydown", (event) => {
            event.stopPropagation();
          });
          checkbox.addEventListener("change", () => {
            setRowSelected(item.id, checkbox.checked);
          });

          row.addEventListener("click", () => handleRowActivation(item));
          row.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleRowActivation(item);
            }
          });

          return row;
        });

  elements.exceptionTable.replaceChildren(...rows);
  syncSelectionUi();
}

async function selectAndSend(row) {
  state.lastRow = row;
  setActiveRow(row.id);

  await sendRows([row], "message.prepared");
}

function handleRowActivation(row) {
  setActiveRow(row.id);

  if (isSelectionModeActive()) {
    setRowSelected(row.id, !state.selectedRowIds.has(row.id));
    return;
  }

  void selectAndSend(row);
}

function isSelectionModeActive() {
  return state.selectedRowIds.size > 0;
}

async function sendSelectedRows() {
  const rows = EXCEPTIONS.filter((item) => state.selectedRowIds.has(item.id));

  if (rows.length === 0) {
    logEvent("message.skipped", {
      reason: "Select one or more payment exceptions before sending a batch."
    });
    return;
  }

  state.lastRow = rows[0];
  await sendRows(rows, "message.batch.prepared");
}

async function sendRows(rows, preparedEventType) {
  const config = readConfig();
  const options = buildSendOptions({
    streamId: config.streamId,
    activeStreamId: state.activeStreamId
  });
  const origin = buildStructuredObjectOrigin(options);
  const payload = rows.length === 1
    ? buildSymphonyMessage(rows[0], origin)
    : buildSymphonyBatchMessage(rows, origin);

  if (!canUseSymphony()) {
    logEvent("message.skipped", {
      reason: "Load the Symphony Embedded Mode SDK before sending a row to chat.",
      messageId: payload.metadata.messageId
    });
    return;
  }

  try {
    await secureMessageActions(payload);
  } catch (error) {
    logEvent("message.security.failed", {
      messageId: payload.metadata.messageId,
      reason: error.message
    });
    return;
  }

  const preparedPayload = {
    messageId: payload.metadata.messageId,
    message: redactActionTokens(payload.message),
    options
  };

  logEvent(preparedEventType, preparedPayload);

  const result = await sendWithSymphony(payload.message, options);
  recordMessageDelivery(payload.metadata, result, origin);
}

async function secureMessageActions(payload) {
  const request = buildActionIntentRequest(payload);
  const response = await fetch(EXTENSION_ACTION_INTENTS_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(request)
  });
  const responseBody = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(responseBody?.reason || responseBody?.error || `Action intent service returned ${response.status}.`);
  }

  attachActionIntentsToMessage(payload, responseBody);
  logEvent("message.security.intents.created", {
    messageId: payload.metadata.messageId,
    intentCount: Array.isArray(responseBody?.intents) ? responseBody.intents.length : 0,
    expiresAt: responseBody?.expiresAt || null
  });
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildStructuredObjectOrigin(options) {
  return {
    streamId: Array.isArray(options.streamIds) ? options.streamIds[0] : null,
    hostPage: window.location.origin + window.location.pathname
  };
}

function recordMessageDelivery(metadata, result, origin) {
  if (!result || result.error) {
    return;
  }

  const deliveries = Array.isArray(result.messages) ? result.messages : [];
  const deliveryRecord = {
    hostMessageId: metadata.messageId,
    entityId: metadata.entityId,
    objectType: metadata.objectType,
    rowCount: metadata.rowCount,
    intendedStreamId: origin.streamId,
    deliveries: deliveries.map((delivery) => ({
      symphonyMessageId: delivery.messageId || null,
      streamId: delivery.streamId || origin.streamId || null
    })),
    recordedAt: new Date().toISOString()
  };

  state.deliveryByHostMessageId.set(metadata.messageId, deliveryRecord);
  logEvent("message.delivery.recorded", deliveryRecord);
}

function setActiveRow(id) {
  elements.exceptionTable.querySelectorAll("tr").forEach((row) => {
    row.setAttribute("data-active", String(row.dataset.id === id));
  });
}

function setRowSelected(id, selected) {
  if (selected) {
    state.selectedRowIds.add(id);
  } else {
    state.selectedRowIds.delete(id);
  }

  syncSelectionUi();
}

function setAllRowsSelected(selected) {
  state.selectedRowIds = selected
    ? new Set(EXCEPTIONS.map((item) => item.id))
    : new Set();
  syncSelectionUi();
}

function syncSelectionUi() {
  const selectedCount = state.selectedRowIds.size;
  const totalCount = EXCEPTIONS.length;

  elements.exceptionTable.querySelectorAll("tr").forEach((row) => {
    const selected = state.selectedRowIds.has(row.dataset.id);
    const checkbox = row.querySelector(".row-select");

    row.setAttribute("aria-selected", String(selected));
    if (checkbox) {
      checkbox.checked = selected;
    }
  });

  elements.selectedCount.textContent = `${selectedCount} selected`;
  elements.sendSelectedButton.disabled = selectedCount === 0;
  elements.selectAllRows.checked = selectedCount === totalCount;
  elements.selectAllRows.indeterminate = selectedCount > 0 && selectedCount < totalCount;
}

async function sendWithSymphony(message, options) {
  try {
    const result = await window.symphony.sendMessage(message, options);
    if (result && result.error) {
      logEvent("message.failed", result);
      return result;
    }

    logEvent("message.sent", result || { status: "resolved without response body" });
    return result || null;
  } catch (error) {
    logEvent("message.failed", serializeError(error));
    return null;
  }
}

function canUseSymphony() {
  return Boolean(window.symphony && typeof window.symphony.sendMessage === "function");
}

async function loadEmbeddedMode() {
        const { podUrl, partnerId, streamId, auditFeedUrl } = readConfig();

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

        configureAuditFeed(auditFeedUrl);

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
    serializeError
  });

  if (state.activeStreamId && !elements.streamId.value.trim()) {
    elements.streamId.value = state.activeStreamId;
  }
}

function renderEmptyLog() {
        if (elements.eventTableBody.children.length > 0) {
          return;
        }

        elements.eventTableBody.innerHTML = `
          <tr class="empty-events">
            <td colspan="6">
              <strong>No audit events logged</strong><br>
              Structured-object sends and action audit state changes appear here.
            </td>
          </tr>
        `;
      }

function handleStructuredObjectAuditMessage(event) {
  const data = event.data;

  if (!data || data.source !== AUDIT_EVENT_SOURCE || data.type !== AUDIT_EVENT_TYPE) {
    return;
  }

  if (!isTrustedAuditOrigin(event.origin, TRUSTED_AUDIT_ORIGINS)) {
    logEvent("structured-object.action.audit.blocked", {
      origin: event.origin,
      reason: "Unexpected postMessage origin for structured-object audit event.",
      expectedOrigins: Array.from(TRUSTED_AUDIT_ORIGINS)
    });
    return;
  }

  receiveStructuredObjectAuditEvent({
    envelope: data,
    receivedFrom: {
      channel: "postMessage",
      origin: event.origin
    }
  });
}

function receiveStructuredObjectAuditEvent({ envelope, receivedFrom }) {
  const auditEvent = {
    ...envelope.payload,
    receivedAt: new Date().toISOString()
  };
  const deliveryRecord = findDeliveryRecordForAuditEvent(auditEvent);

  if (isDuplicateAuditEvent(state, auditEvent)) {
    logEvent("structured-object.action.audit.duplicateIgnored", {
      receivedFrom,
      auditEvent,
      deliveryRecord
    });
    return;
  }

  logEvent("structured-object.action.audit.received", {
    direction: "inbound",
    receivedFrom,
    auditEvent,
    deliveryRecord
  });
  applyAuditStateChange(auditEvent);
}

function configureAuditFeed(auditFeedUrl) {
  if (state.auditFeedTimer) {
    window.clearInterval(state.auditFeedTimer);
    state.auditFeedTimer = null;
  }

  state.auditFeedLastSequence = 0;

  if (!auditFeedUrl) {
    logEvent("audit.feed.disabled", {
      reason: "No Audit Feed URL configured. Production action callbacks should be read from an authenticated backend feed."
    });
    return;
  }

  pollAuditFeed(auditFeedUrl);
  state.auditFeedTimer = window.setInterval(() => {
    pollAuditFeed(auditFeedUrl);
  }, 3000);
}

async function pollAuditFeed(auditFeedUrl) {
  const requestUrl = new URL(auditFeedUrl, window.location.href);

  if (state.auditFeedLastSequence > 0) {
    requestUrl.searchParams.set("after", String(state.auditFeedLastSequence));
  }

  try {
    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      credentials: resolveAuditFeedCredentials(requestUrl, EXTENSION_APP_ORIGIN),
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      logEvent("audit.feed.failed", {
        status: response.status,
        statusText: response.statusText,
        url: auditFeedUrl
      });
      return;
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
      if (state.auditFeedTimer) {
        window.clearInterval(state.auditFeedTimer);
        state.auditFeedTimer = null;
      }

      logEvent("audit.feed.disabled", {
        reason: "Audit Feed URL did not return JSON. Replace the default host page URL with a backend audit feed endpoint when action callbacks need to be replayed into the dashboard.",
        url: auditFeedUrl,
        contentType
      });
      return;
    }

    const body = await response.json();
    const events = Array.isArray(body.events) ? body.events : [];

    events.forEach((entry) => {
      const sequence = Number(entry.sequence || 0);
      const envelope = entry.event || entry;

      if (sequence > state.auditFeedLastSequence) {
        state.auditFeedLastSequence = sequence;
      }

      if (isStructuredObjectAuditEnvelope(envelope, AUDIT_EVENT_SOURCE, AUDIT_EVENT_TYPE)) {
        receiveStructuredObjectAuditEvent({
          envelope,
          receivedFrom: {
            channel: "auditFeed",
            url: auditFeedUrl,
            sequence: sequence || null
          }
        });
      }
    });

    if (Number(body.latestSequence) > state.auditFeedLastSequence) {
      state.auditFeedLastSequence = Number(body.latestSequence);
    }
  } catch (error) {
    logEvent("audit.feed.failed", {
      url: auditFeedUrl,
      error: serializeError(error)
    });
  }
}

function applyAuditStateChange(auditPayload) {
  const auditStateChange = applyAuditStateChangeToState(state, auditPayload);

  if (!auditStateChange) {
    return;
  }

  logEvent("audit.state.changed", {
    auditEvent: auditStateChange.auditEvent,
    hostMessageId: auditStateChange.hostMessageId,
    deliveryRecord: auditStateChange.deliveryRecord,
    actionState: Array.from(state.actionState.values()),
    auditTrailSize: state.auditTrail.length
  });
}

function findDeliveryRecordForAuditEvent(auditEvent) {
  const hostMessageId = resolveAuditHostMessageId(auditEvent);
  return hostMessageId ? state.deliveryByHostMessageId.get(hostMessageId) || null : null;
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
        const direction = getEventDirection(type, payload);

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
          <td class="event-type-cell">
            ${direction ? `<span class="event-direction ${escapeHtml(direction.className)}">${escapeHtml(direction.label)}</span>` : ""}
            <span class="mono event-type-name">${escapeHtml(type)}</span>
          </td>
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

    function getEventDirection(type, payload) {
        if (payload?.direction === "inbound" || type === "structured-object.action.audit.received" || type === "audit.state.changed") {
          return { label: "Inbound", className: "inbound" };
        }

        if (type.startsWith("message.")) {
          return { label: "Outbound", className: "outbound" };
        }

        return null;
      }

    function buildEventPreview(payload) {
        if (!payload) {
          return "";
        }

        if (typeof payload === "string") {
          return payload;
        }

        const interestingKeys = [
          "intent",
          "messageId",
          "hostMessageId",
          "streamId",
          "intendedStreamId",
          "activeStreamId",
          "exceptionId",
          "action",
          "status",
          "reason"
        ];

        if (payload.hostMessageId && Array.isArray(payload.deliveries)) {
          return [
            "direction: outbound",
            `hostMessageId: ${payload.hostMessageId}`,
            formatDeliveryPreview(payload.deliveryRecord || payload),
            payload.intendedStreamId ? `streamId: ${payload.intendedStreamId}` : "",
            payload.rowCount ? `rows: ${payload.rowCount}` : ""
          ].filter(Boolean).join(" | ");
        }

        const preview = interestingKeys
          .filter((key) => payload[key] !== undefined && payload[key] !== null)
          .map((key) => `${key}: ${String(payload[key])}`)
          .join(" | ");

        if (payload.auditEvent) {
          return [
            payload.direction ? `direction: ${payload.direction}` : "",
            payload.receivedFrom?.channel ? `channel: ${payload.receivedFrom.channel}` : "",
            payload.hostMessageId ? `hostMessageId: ${payload.hostMessageId}` : `hostMessageId: ${resolveAuditHostMessageId(payload.auditEvent) || "unknown"}`,
            `action: ${payload.auditEvent.action}`,
            `exceptionId: ${payload.auditEvent.exceptionId}`,
            formatAuditStreamPreview(payload.auditEvent),
            `status: ${payload.auditEvent.status}`,
            formatActorPreview(payload.auditEvent.actor),
            formatDeliveryPreview(payload.deliveryRecord)
          ].filter(Boolean).join(" | ");
        }

        if (payload.actor) {
          return [
            `action: ${payload.action}`,
            `exceptionId: ${payload.exceptionId}`,
            payload.hostMessageId ? `hostMessageId: ${payload.hostMessageId}` : "",
            formatAuditStreamPreview(payload),
            `status: ${payload.status}`,
            formatActorPreview(payload.actor),
            formatDeliveryPreview(payload.deliveryRecord || { deliveries: payload.deliveries })
          ].filter(Boolean).join(" | ");
        }

        if (payload.error && payload.error.message) {
          return `error: ${payload.error.message}`;
        }

        return preview || JSON.stringify(payload);
      }

    function formatAuditStreamPreview(auditEvent) {
        const origin = auditEvent && auditEvent.origin;
        const streamId = origin && origin.streamId;
        return streamId ? `streamId: ${streamId}` : "";
      }

    function formatActorPreview(actor) {
        if (!actor || typeof actor !== "object") {
          return "";
        }

        const label = actor.displayName || actor.username || actor.email || actor.userId;
        return label ? `actor: ${label}` : "";
      }

    function formatDeliveryPreview(deliveryRecord) {
        if (!deliveryRecord || !Array.isArray(deliveryRecord.deliveries) || deliveryRecord.deliveries.length === 0) {
          return "";
        }

        const symphonyIds = deliveryRecord.deliveries
          .map((delivery) => delivery.symphonyMessageId)
          .filter(Boolean);

        if (symphonyIds.length === 0) {
          return "";
        }

        return `symphonyMessageId: ${symphonyIds.join(", ")}`;
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
