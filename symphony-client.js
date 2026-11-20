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
  allowedApps,
  state,
  setLoadButtonBusy,
  setSdkStatus,
  logEvent,
  serializeError
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
      ...(allowedApps ? { allowedApps } : {}),
      canAddPeople: true,
      ecpLoginPopup: loginMode === "popup",
      ...CHAT_CHROME_SETTINGS
    };

    const authState = await checkEmbeddedAuth(logEvent, serializeError);
    const renderArgs = buildRenderArgs({ renderConfig, authState, loginMode });

    const renderResult = await withTimeout(
      window.symphony.render(containerId, ...renderArgs),
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

async function checkEmbeddedAuth(logEvent, serializeError) {
  const checkAuth = window.symphony && window.symphony.checkAuth;
  if (typeof checkAuth !== "function") {
    logEvent("sdk.authCheck.unavailable", {
      reason: "checkAuth is not exposed by the current Embedded Mode SDK."
    });
    return null;
  }

  try {
    const authState = await Promise.resolve(checkAuth(true));
    logEvent("sdk.authCheck.completed", authState || { isLoggedIn: true });
    return authState || null;
  } catch (error) {
    logEvent("sdk.authCheck.failed", serializeError(error));
    return null;
  }
}

function buildRenderArgs({ renderConfig, authState, loginMode }) {
  if (!authState || authState.isLoggedIn) {
    return [renderConfig];
  }

  if (authState.authenticationType === "password" && loginMode !== "popup") {
    return [renderConfig, true];
  }

  return [
    {
      ...renderConfig,
      ecpLoginPopup: true
    }
  ];
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
