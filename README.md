# Symphony chat action buttons with FDC3

This branch demonstrates how to send a Symphony chat message with an FDC3 action button using the Embedded Mode SDK. Clicking **Chart AAPL** in the delivered message raises `ViewChart` with an `fdc3.instrument` context for `AAPL`.

Live UAT verified that Symphony delivered the messages, rendered the buttons in Embedded Mode, and routed **Chart AAPL** through FINOS Sail to an already-running FINOS FDC3 Workbench listener. Launching a closed receiving app from a live Symphony click still needs verification.

**[Open the FDC3 demo guide](examples/native-fdc3-action-buttons/README.md)** for local HTTPS setup, the message payload, a flow diagram, and steps to reproduce the Sail and Workbench test.

The repository’s separate treasury structured-object example has its own [setup guide](STRUCTURED-OBJECTS.md).
