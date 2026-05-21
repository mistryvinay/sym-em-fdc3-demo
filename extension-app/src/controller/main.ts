import { startControllerApp } from './startControllerApp';

void startControllerApp().catch((error: unknown) => {
  window.console.error('structured-object.controller.failed', error);
});
