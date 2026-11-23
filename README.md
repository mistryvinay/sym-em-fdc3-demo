# Symphony chat action buttons with FDC3

This branch demonstrates how to send a Symphony chat message with FDC3 action buttons using the Embedded Mode SDK. The buttons raise the standard FDC3 intents `ViewChart`, `ViewInstrument`, and `ViewOrders` with an `fdc3.instrument` context for `AAPL`.

Live UAT verified that Symphony delivered and rendered **Chart AAPL** in Embedded Mode and routed a click through FINOS Sail to an already-running FINOS FDC3 Workbench listener. Launching a closed receiving app from a live Symphony click still needs verification.

**[Open the FDC3 demo guide](examples/native-fdc3-action-buttons/README.md)** for local HTTPS setup, the message payload, a flow diagram, and steps to reproduce the Sail and Workbench test.

The repository’s separate treasury structured-object example has its own [setup guide](STRUCTURED-OBJECTS.md).
