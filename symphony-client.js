const RENDER_TIMEOUT_MS = 15000;

export const CHAT_CHROME_SETTINGS = Object.freeze({
  condensed: false,
  showInfo: false,
  showMembers: false,
  showTitle: false,
  symphonyLogo: false,
  sound: false
});

export function registerGlobalSdkHook(onSdkLoaded) {
  window.onECPSdkLoaded = onSdkLoaded;
}

export async function ensureSdkScript({ podUrl, partnerId, state, setLoadButtonBusy, setSdkStatus, logEvent }) {
  if (state.loadingSdk) {
    return;
  }

  state.loadingSdk = true;
  setLoadButtonBusy(true);
  setSdkStatus("Loading SDK", "pending");

  const script = document.createElement("script");
  script.id = "symphony-ecm-sdk";
  script.src = `https://${podUrl}/embed/sdk.js`;
  script.setAttribute("render", "explicit");
  script.setAttribute("data-onload", "onECPSdkLoaded");
  script.setAttribute("data-partner-id", partnerId);
  script.onerror = () => {
    state.loadingSdk = false;
    setLoadButtonBusy(false);
    setSdkStatus("SDK load failed", "error");
    logEvent("sdk.load.failed", { src: script.src });
  };

  document.body.appendChild(script);
  logEvent("sdk.load.started", { src: script.src, partnerId });
}

export async function renderEmbeddedChat({
  streamId,
  themeMode,
  loginMode,
  containerId,
  containerSelector,
  containerElement,
  state,
  setLoadButtonBusy,
  setSdkStatus,
  logEvent,
  serializeError,
  onInteropAction
}) {
  if (!streamId) {
    setSdkStatus("Stream required", "pending");
    logEvent("sdk.render.skipped", {
      reason: "A Stream ID is required before rendering Embedded Mode."
    });
    return;
  }

  if (state.renderingSdk) {
    logEvent("sdk.render.skipped", { reason: "A render or stream switch is already in progress." });
    return;
  }

  state.renderingSdk = true;
  setLoadButtonBusy(true);

  try {
    if (state.sdkReady && streamId === state.activeStreamId) {
      logEvent("sdk.streamUnchanged", { streamId });
      return;
    }

    if (state.sdkReady && typeof window.symphony.openStream === "function") {
      await applyChatChromeSettings();
      const openResult = await window.symphony.openStream(streamId, containerSelector, CHAT_CHROME_SETTINGS);
      await applyChatChromeSettings();
      state.activeStreamId = getStreamIdFromResult(openResult) || streamId;
      logEvent("sdk.streamOpened", openResult || { streamId });
      return;
    }

    registerUserInteractionHandler(state, setSdkStatus, logEvent);

    containerElement.querySelectorAll("iframe").forEach((frame) => frame.remove());

    const renderConfig = {
      mode: themeMode,
      streamId,
      allowChatCreation: true,
      canAddPeople: true,
      ecpLoginPopup: loginMode === "popup",
      ...CHAT_CHROME_SETTINGS
    };

    const renderResult = await withTimeout(
      window.symphony.render(containerId, renderConfig),
      RENDER_TIMEOUT_MS,
      "window.symphony.render"
    );
    throwIfSdkResultFailed(renderResult, "window.symphony.render");
    await applyChatChromeSettings();

    const resolvedStreamId = getStreamIdFromResult(renderResult) || streamId;
    if (resolvedStreamId) {
      state.activeStreamId = resolvedStreamId;
    }

    state.sdkReady = true;
    state.loadingSdk = false;
    setSdkStatus("SDK ready", "ready");
    logEvent("sdk.rendered", {
      renderResult: renderResult || renderConfig,
      streamId: resolvedStreamId,
      appliedChrome: CHAT_CHROME_SETTINGS
    });

    await registerInteropHandler(state, logEvent, onInteropAction, serializeError);
  } catch (error) {
    state.sdkReady = false;
    state.loadingSdk = false;
    setSdkStatus("Render failed", "error");
    logEvent("sdk.render.failed", serializeError(error));
  } finally {
    state.renderingSdk = false;
    setLoadButtonBusy(false);
  }
}

async function registerInteropHandler(state, logEvent, onInteropAction, serializeError) {
  if (state.interopRegistered) {
    logEvent("interop.skipped", { reason: "Interop callback is already registered." });
    return;
  }

  /*
   * This registration is what turns button clicks back into observable demo
   * events. Without it, the FDC3 intent entities still render in chat, but the
   * host page never receives the clicked intent/context payload for logging.
   */
  const registerInterop = getFirstFunction([
    window.symphony && window.symphony.registerInterop,
    window.symphony && window.symphony.registerinterop,
    window.registerInterop,
    window.registerinterop
  ], window.symphony || window);

  if (typeof registerInterop !== "function") {
    logEvent("interop.unavailable", {
      reason: "registerInterop is not exposed by the current Embedded Mode plan or SDK version."
    });
    return;
  }

  try {
    await registerInterop(onInteropAction);
    state.interopRegistered = true;
    logEvent("interop.registered", { callback: onInteropAction.name || "anonymous" });
  } catch (error) {
    logEvent("interop.registration.failed", serializeError(error));
  }
}

function registerUserInteractionHandler(state, setSdkStatus, logEvent) {
  if (state.userInteractionHandlerRegistered) {
    return;
  }

  const onUserInteractionRequired = window.symphony && window.symphony.onUserInteractionRequired;
  if (typeof onUserInteractionRequired !== "function") {
    return;
  }

  state.userInteractionHandlerRegistered = true;
  onUserInteractionRequired(() => {
    setSdkStatus("Action required", "pending");
    logEvent("sdk.userInteractionRequired", {
      reason: "Embedded Mode needs the user to complete an in-frame login, EULA, terms, or access step."
    });
  });
}

async function applyChatChromeSettings() {
  if (!window.symphony || typeof window.symphony.updateSettings !== "function") {
    return;
  }

  await Promise.resolve(window.symphony.updateSettings(CHAT_CHROME_SETTINGS));
}

function getFirstFunction(candidates, thisArg) {
  const fn = candidates.find((candidate) => typeof candidate === "function");
  return fn ? fn.bind(thisArg) : null;
}

function getStreamIdFromResult(result) {
  if (!result || typeof result !== "object") {
    return "";
  }

  return result.streamId || "";
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function throwIfSdkResultFailed(result, label) {
  if (!result || !result.error) {
    return;
  }

  const error = new Error(result.error.message || `${label} returned an SDK error.`);
  error.name = result.error.type || "SDKError";
  error.data = result;
  throw error;
}