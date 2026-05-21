import * as ADK from '@symphony-ui/adk';

import { loadRuntimeConfig, type RuntimeConfig } from './config';
import {
  hasSymphonyHostContext,
  registerStructuredObjectRenderer,
  type ViewerContext,
} from './registerStructuredObjectRenderer';

const ADK_START_TIMEOUT_MS = 8_000;
type ControllerWindow = Window & typeof globalThis & {
  __symEmControllerStartPromise?: Promise<unknown>;
  __symEmNavigationRegistered?: boolean;
};

export async function startControllerApp(): Promise<void> {
  if (!hasSymphonyHostContext()) {
    window.console.info('structured-object.controller.standalone');
    return;
  }

  const config = await loadRuntimeConfig();
  const startup = await startAdkWithTimeout(config.symphonyAppId);
  registerStructuredObjectRenderer({
    config,
    viewer: readViewerFromStartup(startup),
  });
  registerLoadedNavigationItem(config);
}

function startAdkWithTimeout(appId: string): Promise<unknown> {
  const currentWindow = getControllerWindow();

  if (!currentWindow.__symEmControllerStartPromise) {
    currentWindow.__symEmControllerStartPromise = Promise.race([
      ADK.start({ id: appId }),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          reject(new Error(`ADK.start did not complete within ${ADK_START_TIMEOUT_MS}ms.`));
        }, ADK_START_TIMEOUT_MS);
      }),
    ]).catch((error) => {
      currentWindow.__symEmControllerStartPromise = undefined;
      throw error;
    });
  }

  return currentWindow.__symEmControllerStartPromise;
}

function registerLoadedNavigationItem(config: RuntimeConfig): void {
  const currentWindow = getControllerWindow();

  if (currentWindow.__symEmNavigationRegistered) {
    return;
  }

  try {
    ADK.navigation.add(
      'Treasury Exceptions',
      () => {
        window.console.info('structured-object.controller.loaded', {
          appId: config.symphonyAppId,
          objectType: config.objectType,
        });
      },
      new URL('./icon.svg', window.location.href).toString(),
    );
    currentWindow.__symEmNavigationRegistered = true;
  } catch (error) {
    window.console.warn('structured-object.navigation.failed', error);
  }
}

function getControllerWindow(): ControllerWindow {
  return window as ControllerWindow;
}

function readViewerFromStartup(startup: unknown): ViewerContext {
  if (typeof startup !== 'object' || startup === null) {
    return null;
  }

  const data = startup as Partial<{
    jwt: string;
    userReferenceId: string | number;
    properties: Partial<{
      userId: string | number;
      id: string | number;
      displayName: string;
      emailAddress: string;
      email: string;
      username: string;
    }>;
  }>;
  const jwtUser = readUserFromJwt(data.jwt);
  const userId = data.properties?.userId ?? data.properties?.id ?? jwtUser?.id ?? data.userReferenceId;

  if (userId === undefined || userId === null) {
    return null;
  }

  return {
    userId: String(userId),
    displayName: data.properties?.displayName || jwtUser?.displayName || '',
    email: data.properties?.emailAddress || data.properties?.email || jwtUser?.emailAddress || jwtUser?.email || '',
    username: data.properties?.username || jwtUser?.username || '',
  };
}

function readUserFromJwt(jwt: string | undefined): Partial<{
  id: string | number;
  displayName: string;
  emailAddress: string;
  email: string;
  username: string;
}> | null {
  if (!jwt) {
    return null;
  }

  try {
    const payload = JSON.parse(window.atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      user?: Partial<{
        id: string | number;
        displayName: string;
        emailAddress: string;
        email: string;
        username: string;
      }>;
    };

    return payload.user || null;
  } catch {
    return null;
  }
}
