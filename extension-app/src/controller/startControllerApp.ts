import { start } from '@symphony-ui/adk/lib/impl/SymADK';
import { add as addNavigationItem } from '@symphony-ui/adk/lib/impl/Navigation';
import { SERVICE_API_CONFIGURATIONS } from '@symphony-ui/adk/lib/impl/Utils';

import { loadRuntimeConfig, type RuntimeConfig } from './config';
import {
  hasSymphonyHostContext,
  registerStructuredObjectRenderer,
  type ViewerContext,
} from './registerStructuredObjectRenderer';

const ADK_START_TIMEOUT_MS = 8_000;

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
  SERVICE_API_CONFIGURATIONS.length = 0;

  return Promise.race([
    start({ id: appId }),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`ADK.start did not complete within ${ADK_START_TIMEOUT_MS}ms.`));
      }, ADK_START_TIMEOUT_MS);
    }),
  ]);
}

function registerLoadedNavigationItem(config: RuntimeConfig): void {
  try {
    addNavigationItem(
      'Treasury Exceptions',
      () => {
        window.console.info('structured-object.controller.loaded', {
          appId: config.symphonyAppId,
          objectType: config.objectType,
        });
      },
      new URL('./icon.svg', window.location.href).toString(),
    );
  } catch (error) {
    window.console.warn('structured-object.navigation.failed', error);
  }
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
