# Nexora IoT Cloud

An operations console for fleets of connected devices — real-time telemetry, automation rules,
alerting, remote commands and OTA firmware rollouts.

**Frontend-only.** There is no backend; devices, physics, radio link, transport, latency and
packet loss are all simulated in the browser. The point isn't charts of fake numbers — it's
that the whole causal chain actually runs:

```
 telemetry → threshold breach → alert → rule fires → command dispatched
      ↑                                                      ↓
      └──────── device physics change ←── device acknowledges ┘
                        ↓
                 alert auto-resolves
```

Open the simulator panel (`⌘⇧S`) and run the walkthrough: a fault is injected into a real
cold-storage device, its temperature climbs past the compliance threshold, raises a critical
alert, trips the cold-chain rule, which dispatches a fan command, which the device
acknowledges, which changes the physics it then reports, which brings the reading back under
the recovery threshold and auto-resolves the alert. Nothing is scripted — the walkthrough
narrates events it observes, and a broken rule engine would visibly stall it.
`platform.integration.test.ts` drives that chain through the real composition root.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 244 tests
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # production build
npm run smoke:map  # browser smoke test (needs a dev server running)
```

| Keys  | Action                             |
| ----- | ---------------------------------- |
| `⌘K`  | Global search / command palette    |
| `⌘⇧S` | Simulator + failure injection      |
| `⌘⇧D` | Developer diagnostics              |
| `⌘B`  | Collapse sidebar                   |

**Worth a look:** the dashboard's live chain; `⌘⇧S` → walkthrough; 1,000 devices paged in the
table (toggle paging ↔ continuous scroll in the footer); any device page for gauges, history
and a health score broken down by factor; the rule builder's execution log; editing a
threshold and reloading to find it still there; CSV export on Devices, Alerts and Telemetry;
`⌘⇧D` for tick cost, FPS, buffer memory and dropped frames.

---

## Architecture

The organising principle: **React components are presentational. Nothing that matters happens
inside one.**

```
simulator (signals → profiles → engine)      physics, faults, round-robin ticks
        │ publish
   MockSocket                                latency · jitter · packet loss
        │ emit
   EventBus                                  one typed vocabulary
        ├── IngestionPipeline   ring buffers, thresholds, status, health
        ├── AlertEngine         hysteresis, dedupe, escalation
        ├── RuleEngine          cooldowns, sustain → CommandService / FirmwareService
        └── ActivityFeedBridge  buffered flush
        │
   10 Zustand stores → 16 hook modules → React components
        │
   applyCommandEffect() ───────────────► back into the device's physics
```

`services/platform/platform.ts` is the only module that knows both halves. Services never
import stores; stores never import services. So the whole domain can be instantiated in a test
with fake sinks, and the UI could be replaced without touching domain logic.

---

## Simulation

**Telemetry behaves like telemetry.** Random numbers per tick look nothing like a sensor, so
`signals.ts` models an **Ornstein–Uhlenbeck process** (mean-reverting drift + Brownian noise)
layered with: deterministic drift (battery discharge, ageing), spikes that *decay back* rather
than step permanently, progressive faults that then heal, and external actuation from the rule
engine. Noise scales by `√dt`, so the walk is sample-rate independent. Every function is pure,
which is what lets tests assert *"a cold-storage sensor holds ±1 °C over 500 ticks"*.

Ten device types each have their own signal profile — a cold-storage and an outdoor sensor both
report `temperature`, but one is refrigerated and one tracks the weather. You can tell what a
device *is* from its chart. Eight sites across five regions carry climate profiles, so ambient
conditions follow believable daily and seasonal cycles.

**Determinism.** Seeded PRNG (mulberry32) with per-device derived seeds. The same seed gives
the same fleet, which makes the simulator testable — and scaling 1,000 → 5,000 devices keeps
the first 1,000 byte-identical rather than replacing the operator's fleet.

**Round-robin sampling.** Each tick advances a slice of the fleet; each device's `dt` is the
real elapsed time since *it* last reported, so continuity survives thin sampling.

**Transport.** `MockSocket` is WebSocket-shaped with no socket behind it. Routing everything
through a transport that can be slow, lossy and disconnected means the UI must handle what
actually makes an operations console hard — and it surfaced two real ordering bugs, both caught
by the integration test: a frame published just before a disconnect can arrive just after,
carrying `connected: true` and silently resurrecting an unreachable device; and tick and
injection can share a millisecond, so a timestamp comparison alone isn't enough. Fixed with a
**connection epoch** — the store records when the transport last reported a disconnect and
ingestion discards frames stamped at or before it. Connectivity comes from the transport, never
inferred from a reading.

**Event bus.** One typed vocabulary (`types/events.ts`) is the only contract between simulation
and everything downstream. One batch event per tick (not N); a throwing listener is caught so
the rest still run; the listener list is snapshotted before dispatch so subscribing mid-dispatch
can't corrupt iteration.

---

## Telemetry processing

Telemetry is the highest-frequency data in the app and does **not** live in a React store.
`TelemetryRepository` is a plain object graph read through `useSyncExternalStore` over a
throttled revision counter: React learns data changed a few times a second, while reads are
always current.

Buffers are `Float64Array` timestamps + `Float32Array` values, not arrays of
`{ timestamp, value }` — at fleet scale that's a few MB of contiguous memory instead of a
million short-lived objects for the GC. Every device gets a **cold** buffer (40 samples);
devices the UI is watching are **promoted** to a hot buffer (900 samples), LRU-capped at 24 so
browsing fifty device pages doesn't leak fifty large buffers.

**Aggregation keeps min/max alongside the mean.** A 30-day window is hundreds of thousands of
samples into ~1,200 pixels, and downsampling by mean alone hides exactly what operations teams
care about — a 48 °C spike inside a ten-minute bucket averages to nothing. Charts draw the
envelope behind the line. Detail charts use bucketed mean + envelope; sparklines use **LTTB**,
which preserves shape where there's no room for an envelope. Per-metric modes matter too:
battery takes `last`, motion `sum`, temperature `mean`.

**Long-range history is regenerated, and the UI says so.** Storing 30 days of real samples for
thousands of devices in a tab isn't a sensible trade, so history beyond the live window is
synthesised from the same signal model, seeded per device and metric, and *anchored* so it
meets the current reading without a jump at the seam. The chart marks where regenerated history
ends and recorded telemetry begins. Presenting it silently as recorded fact would be the one
genuinely dishonest thing this project could do.

---

## Domain logic

**Status is derived, never trusted.** The simulator reports physics; ingestion decides meaning.
*Condition* statuses (`online`/`warning`/`critical`/`offline`) recompute from connectivity and
breaches each snapshot. *Lifecycle* statuses (`maintenance`/`updating`) are asserted by an
operator or rollout and win — a device mid-update reporting an odd temperature should read as
"updating", or every rollout looks like an incident.

**Health is a penalty model.** Start at 100, lose points per fault: connectivity, battery,
signal, instability, error rate, open alerts, reporting gap. A weighted average would let a
device with a dead battery score 80 because its signal is fine. The breakdown ships with the
number, so the device page explains *why* it's at 62.

**Thresholds have hysteresis and scope.** A `recovery` level distinct from the firing level
stops a value hovering at the boundary from flapping an alert every tick. Thresholds resolve
`default → device type → group`, because one global "temperature > 30 °C" is simply wrong for a
−18 °C freezer.

**Rules are structured data** — the exact shape the engine evaluates, no translation layer
between what the builder shows and what runs. `evaluateRule` is pure: state in, decision plus
next runtime state out (including `forSeconds` sustain), so a test can drive a condition across
five simulated minutes with no clock. Rules are **indexed by the metrics they read**, so
temperature frames only wake temperature rules. The engine doesn't know how to raise an alert
or send a command — it calls an injected `RuleActionExecutor`, which avoids a dependency cycle
and makes it testable with a recorder. Cooldowns are keyed `rule + device`. Every firing records
which conditions matched *with their values* and the ids of what each action produced, so "why
did this fire at 10:42?" is answerable from the UI.

The builder is a **vertical IF → THEN flow, not a node canvas**. These rules are a condition set
plus an ordered action list — a linear structure. A flow makes that legible, works on a phone
where a pannable canvas doesn't, and is keyboard navigable because every element is a real form
control rather than a draggable div.

**Commands are a lifecycle, not a function call:** `queued → sent → acknowledged → completed`,
or `failed`/`timeout`. Each transition costs real time, and an offline device *times out* rather
than rejecting immediately — the platform can't distinguish "offline" from "slow" until the
window expires. The physical effect applies at **acknowledgement**, not at issue: a fan starts
when the device confirms, not when the operator clicks. Cooling is proportional control toward
the set point, so a fan removes heat but can't refrigerate a freezer below its thermostat.

**Firmware rollouts are windowed, not parallel.** Real fleets don't update 2,000 devices at
once, and an operator wants a chance to abort after the first failures. `concurrency` jobs stay
in flight and the next device is admitted as each finishes, so you watch a queue drain. Devices
go genuinely quiet while installing; a failed update leaves the old version in place.

---

## State and UI

Ten Zustand stores split by **write frequency**, not feature. Splitting `deviceStore` (written
several times a second) from `deviceViewStore` (filters, sort, selection) is the important one:
combined, every filter chip would re-render on every telemetry batch and every batch would
invalidate memoised selectors depending on the filter.

Devices live in a `Map` (telemetry arrives keyed by id; an array means an O(n) scan per frame).
Status counts and the health distribution are **incremental** — updated by diffing each patch,
not by sweeping 5,000 devices every 250 ms. The integration test asserts the incremental tallies
agree with a full sweep, which is what catches a missed decrement.

**Three Web Components, used where they're genuinely better** — novelty would have been worse
than not using them:

- `<nexora-sensor-gauge>` / `<nexora-telemetry-chart>` — **performance**. These repaint far more
  often than React should re-render (a sparkline per visible table row). A new value is a
  property assignment through a ref scheduling one `requestAnimationFrame`; React never learns
  it changed. Series data crosses as a typed array on a property — serialising 900 floats into a
  DOM string per tick would defeat the purpose. Recharts still handles the big interactive
  charts, where tooltips, axes and threshold overlays earn their weight.
- `<nexora-device-status>` — **encapsulation**. The status pill appears in six surfaces; as a
  React component it would be one implementation among several and would drift. Shadow DOM seals
  the appearance: consumers can position it but not restyle its internals.

Interop: registration is an explicit idempotent client call (`customElements` doesn't exist
during SSR), and classes extend an SSR-safe base because `class X extends HTMLElement` is
evaluated at *import* time. Canvas is opaque to assistive tech, so both compose a descriptive
`aria-label`.

**Map.** 5,000 DOM markers isn't viable, so the fleet is a single GeoJSON source with
`cluster: true` rendered as GPU circle layers — three draw calls at any size, clustering in a
worker. `clusterProperties` aggregates per-status counts so a cluster is coloured by the
**worst status it contains**; a cluster showing "142" in green while hiding a critical device
would be actively misleading. Updates are imperative via `setData` on a 2-second tick; React is
not in the update path. The basemap style is inline (no API key, tuned to the dark palette), and
if tiles fail the map degrades to a coordinate plot rather than breaking.

### Two map traps worth knowing

Both produced a map that mounted without error, logged nothing useful, typechecked and built
cleanly — and rendered as an invisible empty box.

1. **The web worker.** MapLibre resolves its worker as a sibling of its own module URL; once a
   bundler rewrites module URLs, that sibling doesn't exist. Since both style *and* tile parsing
   run off the main thread, a dead worker renders nothing. `scripts/copy-maplibre-worker.mjs`
   copies the self-contained worker into `public/` on `postinstall`/`predev`/`prebuild`.
2. **CSS specificity.** MapLibre's stylesheet sets `.maplibregl-map { position: relative }`,
   which has *the same specificity* as Tailwind's `.absolute` and loads from a later chunk — so
   it wins, and a container relying on `absolute inset-0` collapses to zero height because the
   canvas inside is out of flow. The container uses `h-full w-full` and lets MapLibre own
   `position`.

Neither is catchable by `tsc`, `eslint` or `next build`, hence `npm run smoke:map` — it drives
real Chrome and asserts the canvas and drawing buffer have believable dimensions and that
cluster markers exist (proof the worker started). It fails on both regressions.

---

## Performance

Designed for 5,000 devices and thousands of events per second.

| Technique                    | Where                                                   |
| ---------------------------- | ------------------------------------------------------- |
| Event batching               | One batch event per tick, not one per device            |
| Round-robin sampling         | A slice of the fleet reports per tick                   |
| Buffered store commits       | Patches accumulate, commit on a 200 ms interval         |
| Throttled external store     | Telemetry notifies at most every 250 ms                 |
| Incremental aggregates       | Status counts and health bands, never swept             |
| Typed-array ring buffers     | No per-sample objects; hot/cold LRU tiering             |
| Virtualised + paged lists    | 50 rows a page; only the visible window mounts          |
| Canvas Web Components        | Sparklines and gauges bypass the reconciler             |
| GPU map clustering           | Three draw calls for any fleet size                     |
| Metric-indexed rule matching | Only relevant rules evaluate                            |
| Debounced search             | Local input state; the fleet query runs on pause        |
| Quantised time windows       | Chart windows snap to buckets so memoisation hits       |
| Narrow subscriptions         | A KPI tile subscribes to a counts object, not the fleet |
| Bounded histories            | Activity 250, commands 500, resolved alerts 400         |

`⌘⇧D` reports tick cost, FPS, buffer memory, rule evaluations, dropped and stale frames — so
the claims above are checkable rather than asserted.

## Accessibility

- **Status is never colour-only** — glyph + label + `aria-label` on every indicator.
- The device table is `role="table"` with `aria-rowcount` reporting the true filtered total, not
  the dozen rows mounted. `aria-rowindex` is absolute within that total, so the first row of
  page 3 announces as row 101 — a page-relative index would contradict the count beside it.
- The header checkbox says "Select all **visible** devices", because that is what it does;
  selecting beyond the page is a separate button naming the count it affects.
- Battery, signal and health are `role="img"` with descriptive labels; bar glyphs mean nothing
  to a screen reader.
- `prefers-reduced-motion` disables pulse, slide-in and gauge easing — passed into the gauge as
  an attribute so the shadow-DOM animation is suppressed too.
- The activity feed and connection state are `aria-live="polite"`; the status pill deliberately
  is **not**, since announcing every change across a thousand rows would be unusable.

## Responsive

The nine-column table becomes **cards** below `lg` — a nine-column table on a 390 px viewport is
a puzzle, not a table. Both render from the same query, so filtering, sorting and selection
behave identically. The sidebar becomes a drawer. Panels reflow with `auto-fit` grids keyed on
their own width rather than page breakpoints, since they sit in containers of varying size.

---

## Testing

244 tests across 14 files, all against the domain layer — business logic is tested where it
lives, and none of it requires mounting a component. Coverage spans telemetry realism, the
simulation engine, rule evaluation, alert hysteresis, aggregation, the command lifecycle, the
health model, device placement, paging, CSV escaping, persistence, and the full chain end to
end.

Tests assert *behaviour*:

- "a cold-storage sensor holds its set point while an outdoor sensor tracks ambient"
- "a spike survives downsampling in the envelope even when the mean hides it"
- "noise is sample-rate independent: 600 × 1 s and 120 × 5 s have comparable spread"
- "a device mid-update reads as updating, not critical"
- "incremental status counts agree with a full fleet sweep"
- "narrowing a filter returns the table to page 1"

The integration test guards this project's most likely failure mode — a UI that looks like a
platform without being one. It has already earned its keep by catching the two transport
ordering bugs above plus a cooling model that drove devices 14 °C below set point. Seeded
PRNGs, injectable clocks and injectable schedulers let twenty minutes of simulated time run in
milliseconds.

Vitest runs two projects: `node` for the domain, `dom` (jsdom) for the one file that genuinely
needs `localStorage` and `document`. The split is declared in config rather than a
`@vitest-environment` comment, so a file that fails to be collected shows as a project running
zero tests instead of quietly shrinking the total.

---

## Project structure

```
src/
├── app/              12 routes
├── components/       dashboard · devices · maps · rules · shell · simulator · telemetry
│                     shared/ (Panel, KpiTile, Pagination, WC bridges) · ui/ (shadcn)
├── hooks/            16 modules — the only bridge from state to UI
├── services/         alerts · commands · devices · events · firmware · platform
│                     provisioning · rules · simulator · telemetry · websocket
├── stores/           10 Zustand stores
├── types/            domain types, one file per concern
├── utils/            calculations · formatting · export · pagination · persistence · random
└── web-components/   three custom elements + registry + SSR-safe base
```

---

## Trade-offs

Decisions I'd want to defend in review:

**Synthesised long-range history.** Regenerated from the signal model, not recorded. Storing
real samples at that depth in a browser isn't a sensible trade; the honest mitigation is that
the UI marks the seam.

**Mutable simulator state.** `DeviceSimState` is mutated in place — the one departure from the
codebase's immutable default. At 5,000 devices and 10 Hz it would otherwise allocate tens of
thousands of objects a second just to discard them. The boundary is strict: everything leaving
`services/simulator` is immutable, and nothing outside sees the type.

**Module-singleton services.** Bus, socket, simulator and repository are module singletons —
there's one event stream per tab and services must reach each other outside the component tree.
The cost is no second isolated instance per page, but every class is independently
constructible, which is what the tests do.

**Everything is client-rendered.** There's no meaningful server-rendered version of a console
whose dataset is generated in the browser. The shell renders a layout-shaped skeleton until the
fleet seeds; dynamic routes use partial prerendering so the shell stays static.

**Bounded in-memory history.** 400 resolved alerts, 500 commands, 250 activity entries. A real
deployment would page these from a server; unbounded would be a memory leak dressed as a
feature.

**Partial persistence.** Operator-*authored* state only — rules, thresholds, theme. The fleet is
deterministic in its seed, so it reconstructs on reload. Alert acknowledgements are deliberately
*not* persisted: an acknowledgement refers to a specific alert instance, and those are generated
fresh each session, so restoring them would attach decisions to alerts that no longer exist.
Three things that are easy to get wrong, all covered by `utils/persistence.test.ts`: stores use
`skipHydration` and rehydrate after mount (synchronous rehydration would trip React's hydration
check); rehydration bumps each store's `version` so ingestion re-resolves thresholds and the rule
engine rebuilds its index; and theme is applied by a blocking pre-paint script, because an effect
runs after paint — which *is* the flash.

**Next:** a Web Worker for the simulator so it survives main-thread jank; incident grouping so a
regional outage is one incident rather than 200 correlated alerts; broader Playwright coverage,
since the suite deliberately stops at the domain boundary.

---

Next.js 16 · React 19 · TypeScript (strict, no `any`) · Zustand 5 · Recharts 3 · MapLibre GL 6 ·
TanStack Virtual · Tailwind CSS 4 · shadcn/ui (Base UI) · Vitest 5 · native Web Components
