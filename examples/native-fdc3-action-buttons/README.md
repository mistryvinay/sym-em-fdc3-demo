# Symphony chat to FDC3 desktop apps

This demo sends Symphony chat messages with FDC3 action buttons through the Embedded Mode SDK. Use it as a direct SDK control when a button appears in the send preview but the delivered message shows raw text such as `§[View Trade](id/trade)`. It also shows what happens when someone clicks the delivered button, from the Embedded Mode callback to the desktop agent’s routing result.

Use branch `demo/native-fdc3-action-buttons`. The demo runs from the static HTTPS host. Symphony provides the action button renderer and the native desktop connector, so this example requires no extension app. [Symphony desktop interop configuration](https://docs.developers.symphony.com/embedded-modules/desktop-interoperability/configuration-guide)

## What the demo verifies

| Stage | Evidence |
| --- | --- |
| Send through the Embedded Mode SDK | Live UAT sends returned message IDs for the chart and trade messages. The demo calls `window.symphony.sendMessage` directly, so it provides a control for comparing a wrapper integration. |
| Render and click delivered buttons in Embedded Mode | Live UAT showed the delivered buttons and registered clicks for **Chart AAPL**, **View Trade**, and **Launch Blotter**. |
| Render delivered buttons in a separate Symphony session | The same UAT messages showed plain-text labels in regular Chrome and all three buttons in the Symphony web app opened inside an FDC3 container. |
| Route the click to a desktop agent | Browser tests exercised the demo’s `raiseIntent` call and routing outcomes with a simulated agent. The live UAT browser reported **Received · no desktop agent**. |
| Open a receiving app with the right context | Verify this in the target desktop environment with a configured agent and a matching receiver. If recipients use the Symphony Desktop App, verify that client with its native connector as well. |

The UAT results establish a working direct-send control. The original integration’s root cause and end-to-end desktop app launch still need to be verified in its environment.

## Run in a browser

1. From this branch, follow the root README’s [HTTPS host step](../../README.md#1-start-the-host-page-on-port-4000) and open the [native FDC3 demo](https://localhost:4000/examples/native-fdc3-action-buttons/).
2. Enter the test pod hostname and a **Stream ID** you can access. Leave **Partner ID** blank when the UAT pod allows it. Otherwise, supply the ID for your Embedded Mode plan and use an authorized host origin. Click **Load chat** and sign in. The demo automatically registers for button clicks on plans that support the interop API. [Partner ID configuration](https://docs.developers.symphony.com/embedded-modules/embedded-mode/pricing-tiers#partner-id) · [Embedded Mode interop notifications](https://docs.developers.symphony.com/embedded-modules/embedded-mode/notifications#get-notified-of-interop-actions)
3. Click **Send chart check** and confirm the send in Symphony. Find the message in the chat history and look for **Chart AAPL** below the cashtag. Click the delivered button and look for `ViewChart`, `fdc3.instrument`, and `AAPL` in **FDC3 events**.
4. Click **Send trade actions** and repeat for the two custom actions. Expand **SDK diagnostics** to see the request payloads, message IDs, callback events, and routing errors.

| Chat button | Intent | Context type | Identifier |
| --- | --- | --- | --- |
| Chart AAPL | `ViewChart` | `fdc3.instrument` | `ticker: AAPL` |
| View Trade | `com.example.ViewTrade` | `com.example.trade` | `tradeId: DEMO-TRADE-001` |
| Launch Blotter | `com.example.LaunchBlotter` | `com.example.blotter` | `blotterId: DEMO-BLOTTER-001` |

## How it works

[The message builder](messages.js) creates a `SharedMessage`. Its Markdown contains a reference such as `§[Chart AAPL](id/chart)`. The `chart` key in `entities` defines the intent and context. [The demo page](demo.js) sends this directly to the selected stream in Blast mode with Symphony’s default confirmation dialog. [SDK send contract](https://docs.developers.symphony.com/embedded-modules/embedded-mode/send-a-message)

```js
await window.symphony.sendMessage({
  text: { "text/markdown": "**FDC3 connector check**\n\n$AAPL\n\n§[Chart AAPL](id/chart)" },
  entities: {
    chart: {
      type: "fdc3.fdc3Intent",
      data: {
        title: "Chart AAPL",
        intent: "ViewChart",
        context: { type: "fdc3.instrument", id: { ticker: "AAPL" } }
      }
    }
  }
}, { mode: "blast", streamIds: [streamId] });
```

After chat loads, the demo calls `registerInterop`. A button click in the embedded chat calls back into the host page with an intent and context. The demo adds a row to **FDC3 events** and, for the demo actions listed above, calls `window.fdc3.raiseIntent(intent, context)` when a desktop agent is available. **Routed to …** shows that the agent resolved the intent to an app. Check the receiving app for the actual action and context. [Embedded Mode interop notifications](https://docs.developers.symphony.com/embedded-modules/embedded-mode/notifications#get-notified-of-interop-actions) · [FDC3 intent resolution](https://fdc3.finos.org/docs/2.0/api/ref/DesktopAgent#raiseintent)

## Verify that a desktop app opens

1. Open the demo page inside an FDC3-enabled desktop platform such as Here Core (formerly OpenFin Workspace) with FDC3 available to the host page. Configure an app in that platform’s App Directory that handles `ViewChart` with `fdc3.instrument`. An FDC3 Workbench listener can check intent receipt during setup. [Embedded Mode connector setup](https://docs.developers.symphony.com/embedded-modules/desktop-interoperability/configuration-guide/configure-with-embedded-mode) · [Symphony connector troubleshooting](https://docs.developers.symphony.com/embedded-modules/desktop-interoperability/configuration-guide/troubleshooting)
2. With the target app closed, click **Chart AAPL** in the delivered message. If the agent offers a choice of apps, select the chart app. Confirm that it opens and displays the chart for AAPL. Check **FDC3 events** for the routing result.
3. For **View Trade** and **Launch Blotter**, agree on real intent names, context types, and identifiers with the receiving apps’ owners. Update [the demo definitions](messages.js) and the receivers’ App Directory entries and handlers to use the same values. [FDC3 custom intent naming and discovery](https://fdc3.finos.org/docs/2.0/intents/spec#namespaces)
4. To test the recipient’s path, open the **same delivered message** in the Symphony web app inside an FDC3 container, or in the Symphony Desktop App with its native connector configured. Verify the button, then click **Chart AAPL** and confirm that the receiving app gets AAPL. [Symphony desktop interop configuration](https://docs.developers.symphony.com/embedded-modules/desktop-interoperability/configuration-guide)

## Diagnose preview-only buttons

| Observation | What to check |
| --- | --- |
| Preview shows a button, but the delivered message shows fallback text | Open the same message in both sender and recipient sessions. Check whether each viewing session has interop available. In the demo, check the status above **FDC3 events** and look for registration errors in **SDK diagnostics**. In a native connector session, hover over the actual `$AAPL` cashtag and look for **View Instrument**. `window.fdc3` on the host page only demonstrates agent access for that page. [Connector troubleshooting](https://docs.developers.symphony.com/embedded-modules/desktop-interoperability/configuration-guide/troubleshooting) |
| The direct SDK send works, but the wrapper shows raw `§[...]` markup | Compare the exact Markdown and `entities` passed into the SDK. Check that each reference has a matching key and that the opening parenthesis in `§[View Trade](id/trade)` has no literal backslash before it. If the wrapper supplies a Focus mode `container`, verify it targets the rendered container. If the SDK rejects the container, retry the control with the optional override omitted. |
| The direct SDK send also shows raw markup in an interop-enabled session | Use an authorized message read or message event to inspect the delivered presentation and entity data. An absent action entity points to the send or conversion path. If the entity is stored, check rendering and interop in the viewing session. A `StartChat` or bot send can provide a separate control. [Read structured objects](https://docs.developers.symphony.com/bots/messages/overview-of-messageml/entities/structured-objects#reading-objects) · [Bot action buttons](https://docs.developers.symphony.com/bots/messages/overview-of-messageml/entities/standard-entities#fdc3-action-buttons) |
| The SDK returns `messages: []` | The response contains no message ID. Check the conversation for delivery and obtain the ID from the delivered message or an authorized event for comparison. [SDK response contract](https://docs.developers.symphony.com/embedded-modules/embedded-mode/send-a-message#returned-promise) |
| A delivered button is clickable, but no app opens | Check whether the click reached the host, the desktop agent is available on the route being tested, and a receiver advertises the exact intent and context type. Use `ViewChart` with `fdc3.instrument` for the chart control. [FDC3 ViewChart contract](https://fdc3.finos.org/docs/2.0/intents/ref/ViewChart) |

Use the entity shape for the API you are calling. Embedded Mode `sendMessage` uses `fdc3.fdc3Intent` with nested `data`. The FDC3 `StartChat` example uses `fdc3.action` with `action: "raiseIntent"`. [SDK SharedMessage](https://docs.developers.symphony.com/embedded-modules/embedded-mode/send-a-message) · [StartChat message format](https://docs.developers.symphony.com/embedded-modules/desktop-interoperability/fdc3-intents/message-format#fdc3-action-buttons)

Run `npm test` from the repository root to check the payload builders and which actions the demo can forward.
