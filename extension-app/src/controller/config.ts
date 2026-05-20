export type RuntimeConfig = {
  symphonyAppId: string;
  objectType: string;
  auditEndpointUrl?: string;
};

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  symphonyAppId: 'localhost-4001',
  objectType: 'com.mistryvinay.treasury.exception',
  auditEndpointUrl: '',
};

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch(new URL('./controller.config.json', window.location.href).toString(), {
      cache: 'no-store',
    });

    if (!response.ok) {
      return DEFAULT_RUNTIME_CONFIG;
    }

    return {
      ...DEFAULT_RUNTIME_CONFIG,
      ...(await response.json()),
    };
  } catch {
    return DEFAULT_RUNTIME_CONFIG;
  }
}
