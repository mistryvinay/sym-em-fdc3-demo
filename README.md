# Symphony Embedded Mode FDC3 Actions Demo

This sample shows how to:
- render a Symphony Embedded Mode chat into a host container
- send a SharedMessage with FDC3 action buttons
- register interop callbacks so button clicks are surfaced back to the host page
- log SDK lifecycle and FDC3 action events in a local console

## Files
- `index.html`: page shell and DOM containers
- `styles.css`: host layout and chat container sizing
- `app.js`: page bootstrap, event log UI, config handling, and one-shot action handling
- `demo-data.js`: sample treasury exceptions
- `message-builder.js`: SharedMessage payload and FDC3 action entity construction
- `symphony-client.js`: SDK loading, render/openStream, settings, and interop registration

## Required inputs
- Pod URL
- Partner ID
- Stream ID

The sample assumes the browser can authenticate against the target Symphony pod. Without a valid session or login handoff, the embedded iframe will render but the underlying chat bootstrap will fail.

## FDC3 action wiring
Each action button requires two matching pieces:
1. Markdown button markup using `id/<entityId>` in the message text.
2. An `entities[entityId]` object of type `fdc3.fdc3Intent`.

The host page receives the clicked intent through interop registration in `symphony-client.js`.

## Button semantics
This sample treats action buttons as one-shot from the host perspective.
- The first click is logged and processed.
- Repeated clicks with the same action id are ignored by the host.

Note: the existing message inside Symphony is not mutated after click. If you need the button to become visually disabled in chat, that typically requires a message update or replacement capability outside the scope of this sample.

## Embedded Mode Configuration
The sample requests a compact profile through SDK settings:
- `showTitle: false`
- `showMembers: false`
- `showInfo: false`
- `symphonyLogo: false`
- `sound: false`

Some visible iframe chrome may still depend on the target pod, auth state, and SDK plan.

## Known limitations
- No automated tests are included.
- The sample depends on a live Symphony environment.
- Chat-action state is enforced in the host page, not by mutating the original chat message.
