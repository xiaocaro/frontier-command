# Architecture

## Authority

Electron main owns the only authoritative `SimulationEngine`.

Renderer holds only UI state and readonly snapshots. Every world mutation enters the engine through validated structured commands. Hidden enemy state, faction intent, unrevealed world data and RNG state never enter the public snapshot.

Simulation rules use deterministic fixed steps and seeded randomness. Wall-clock time may schedule host work but never decides movement, combat, inventory or faction outcomes.

## World Model

The strategic world is persistent and expandable.

- Space is organized as generated Sector / Star System data, not a fixed rectangular board.
- Unknown sectors are materialized deterministically from the world seed when discovered.
- Discovered systems, planets, anomalies and resource sites become persistent save data.
- Stable internal IDs are separate from player-facing names so ships, colonies, facilities, planets and systems can be renamed safely.
- Navigation, sensors, factions and rendering operate on the same world model.

The map may reveal more space indefinitely without requiring a global `WORLD_WIDTH` / `WORLD_HEIGHT`.

## Command Model

A Starfleet ship is always an independently controllable world entity.

Each ship can hold:

- current directive
- queued directives
- standing orders

New commands use `REPLACE`, `QUEUE` or `INTERRUPT`.

Admiral commands have final authority. Standing Orders and ROE govern autonomous behavior only; they must not block an explicit validated Admiral command.

Directives describe intent such as move, patrol, escort, intercept, shadow, scan, attack, disable, retreat, dock or resupply. The engine resolves pathing, range, weapons, damage, cargo and timing.

No long-lived Mission/Operation may own or lock a ship.

## Shared Activity Systems

Combat, exploration, mining and logistics operate on the same persistent world rather than separate mission pipelines.

- Combat acts on real ships, facilities, positions, weapons and political consequences.
- Exploration reveals real persistent systems, resources and hazards.
- Mining extracts finite world deposits into mine storage.
- Transport moves real goods between actual inventories and routes.

One system's output can create another system's opportunities.

## Economy and Growth

Core resources have explicit meaning:

- `Credits`: strategic budget
- `Materials`: construction, repair and industry
- `Photon` / `Quantum`: physical ammunition
- `Special Finds`: rare capability unlocks

Fleet growth uses limited module slots and capability-changing upgrades.

Starbase growth modifies strategic systems such as Shipyard, Sensors, Armory, Logistics and Defense. Shipbuilding produces persistent new ships; permanent losses remain meaningful without creating an unrecoverable dead end.

## Faction Simulation

Faction actors are persistent entities with their own assets, information and constraints.

### Orion Syndicate

Orion ships, hideouts, cargo, ammunition and losses are real world state. They scout profitable routes, raid weak targets, carry stolen goods home and rebuild only when their economy permits.

### Romulan Border Command

Romulan scouts gather observations. Border Command acts on fresh reports, strategic value, tension and risk. Romulan vessels are not automatically hostile merely because of faction identity.

Faction actions must originate from world state and knowledge, not periodic enemy spawning.

## Agent Boundary

Agent and ship are separate entities.

Ships own physical state. Agents own personality, skills, memory, experience, career and relationships.

Future LLM execution follows:

`observation → model decision → structured action → validation → engine command`

Models never edit `WorldState`, calculate frame-level physics or run every simulation step.

## Persistence

Save data is versioned and validates references, inventories, generated world data, directives, faction state and progression.

Timeline branching and recovery remain transactional: immutable historical snapshots are never rewritten, and engine replacement occurs only after persistence succeeds.

## UI Boundary

The existing LCARS 26 Classic design system is the UI foundation.

- `SECTOR`: expandable Strategic Map and context commands
- `STARBASE`: dedicated full management interface
- other management views present fleet, economy, colonies and history without owning simulation state

Strategic Map uses semantic zoom and renders only known information. UI animation/audio preferences remain separate from world saves.

## Code Boundaries

- `src/engine/`: authoritative world, commands, simulation, factions, economy and save schema
- `src/ui/`: LCARS presentation and interaction
- `src/StrategicMap.*`: strategic world rendering/camera
- `electron/`: engine host, IPC and persistence
- `tests/`: deterministic rules, persistence and Electron E2E

Prefer domain data over scattered constants, strict TypeScript over `any`, and root-cause refactors over compatibility patches around rejected architecture.

## v9 Implementation

The fixed step is 0.1 game-minute, scheduled every 100 ms by the Electron host. A 1x game minute is therefore approximately one real second. Speeds 4/16 repeat the same steps and stop the batch at a major pause. Sensors observe each game minute; faction decisions use simulation-time deadlines.

A directive stores its own phase, work, travelled distance, loaded manifest, delivered amount and remaining physical reservations. Only active/suspended directives reserve stock; queued actions reserve nothing. REPLACE clears all three directive containers. INTERRUPT pushes the current directive onto a LIFO stack. Completion resumes the stack before the FIFO queue and validates what remains, including partially loaded magazines and retained haul manifests. Failed targets release reservations and report the reason; actual cargo is retained.

Sector IDs derive from coordinates; system/body IDs derive from their sector and local index. Coordinate generation uses initialSeed and a local derived PRNG, separate from the mutable combat/cloak RNG. The engine stores generated content and survey tiers; Renderer receives neither random source. Map transforms are unbounded and preserve world center on resize; FIT includes known locations/systems. Local-body labels are shown at local zoom or for a selected system.

Physical inventory belongs to a location, construction site, ship cargo, magazine, enemy hideout or wreck. Credits are the command budget. HAUL reservations move into cargo only after loading; delivery uses the lesser of the actual cargo and remaining manifest. Cancelling does not restore consumed industry materials or unload cargo. Completed construction projects resolve later queued shipments into their resulting facility.

Mine accidents cap shared response work at 20 and consume 5 Materials once, using unreserved facility stock first and the completing onsite vessel's cargo for the remainder. Insufficient combined inventory spends nothing. Snapshot events include derived `accidentResponse` metadata for active owned facilities: local availability and each current responder's proximity-based phase, cargo and shortfall. Suspended/queued responses are excluded. This metadata is not stored in WorldState or saves; the save version remains 10. Existing excess work is clamped when a response continues.

Route forecasts clip both voyage legs against the union of charted Sector rectangles to show the uncharted distance fraction, using public geography only. Risky warp corridors are physically faster and damaging; while a ship is underway they amplify its detectable signature to 1.5x the observer's sensor radius. Docked/loading ships do not retain that exposure. Safe routes are direct when no observed hazard crosses the voyage. Stable, coordinate-only candidate paths avoid discovered anomalies and fresh hostile contacts; facility locations and hidden threats cannot force detours. When no safe candidate exists, the public forecast and execution note explicitly report elevated risk.

Construction uses on-site stock and cannot start work while required goods are reserved for another delivery. Industry jobs independently complete shipbuilding, upgrades and manufacturing without owning vessels. There is no rear resource accumulator. Colony income and limited Exchange orders provide recovery. Exchange escrow is a persistent paid manifest; a preexisting civilian carrier must visit the origin, load, travel and deposit. A new hull takes 25 minutes and receives a fresh ID, independent operator identity and empty magazines. Full manufacturing output waits without duplicate payment or production.

Orion reports record local observations, value, escort defense, freshness and position. Raiders pursue reported positions until acquiring their own sensor contact. Loot is physically transferred, returned and partly consumed by black-market sale; repairs, rearming and replacement hulls use the hideout's finite stock. Docked ships retain a service deadline and can redeploy after it. There is no periodic reinforcement source. Romulan reports plus tension determine command stance; actual boundary crossings, withdrawal, construction and attacks persist in history.

Public Snapshot/Observation types are recursively readonly and detached by structuredClone. Snapshot uses an explicit field whitelist; enemy intent, assets, stocks, reports, seed and unrevealed geography stay private. Contacts retain the frozen last observed position during loss of signal. AgentControllerPort exposes only getObservation and submitAction for its assigned vessel; an active Admiral directive rejects an autonomous submission.

v9 saves use timeline-v9.json and frontiers-v9, independently of all earlier roots; v8 and earlier world formats are rejected without migration or modification. Schema checks clocks, references, stable-ID uniqueness, physical capacities, module slots, reservations, historical counters and industry recipes. Runtime target loss remains a valid historical reference until the directive can handle it. Midnight writes occur in the host's after-step callback before the next accelerated step. The host switches engines only after a restored/new branch has been persisted.

## Frontier domains

`inventory.ts` centralizes available stock, canonical completed-project storage, per-good capacity, deposits and destructive reservation reconciliation. No queued directive reserves source goods. Completed projects transfer their leftover cargo into the new facility. Merchant orders retain un-loaded escrow and loaded/delivered counters; each leg is physical navigation.

`fleet.ts` coordinates current group orders using the slowest participating ship. Directive group slots and spacing are captured when issued, so membership changes affect subsequent commands. Group HAUL reserves one shared total on rendezvous and distributes it in stable flagship/member order. A loading barrier prevents premature departure. Independent overrides leave membership intact. Standing directives share action validation and navigation, and cannot outrank any pending Admiral directive.

`society.ts` stores Colony State and independent Personnel. Training, actual meeting, appointment, experience and bounded skill effects use simulation time. Officers do not select tasks. Initial colonies have explicit commanders; new colony construction establishes its commander. An empty post does not regenerate an unlimited series of new characters.

`world-events.ts` owns persistent evidence, subject, stage, deadline, response, work, outcome and follow-up links. It is separate from transient `SimulationEvent` and rolling communications. Mining exposure, contamination/crowding, actual attacks, surveyed rare objects and observed border conditions trigger events. Refugees leave a real source population, consume passenger capacity and reach an actual destination; carrier loss records real population loss. Invasion references existing faction assets and cannot create ships.

Wormholes are paired coordinate objects with independent local seed, stable/unstable state and physical traversal. Unknown exits are omitted from Snapshot. Exploration reveals varied content and permanent historical entries rather than Credits. Authored Helios deposit and New Horizon world do not rely on a random resource/habitable template.

Enemy local observations stay on the observer until within home communication range. Received intelligence retains original observation time and determines deployment and pressure. Romulan reserves originate at Border Command; observe/patrol/probe/reinforce/escalate/withdraw use received evidence and persistent political tension. Observed hostile fire, not hidden intent, permits autonomous targeting.

Renderer has separate command-object and destination state. Map points do not overwrite the selected ship/group command object. SVG symbol registration is exhaustive over map entity kinds. Shared title bars use non-shrinking pure-color caps, bounded tail geometry and wrapping text across DPI scales. Title content and rounded frame masks occupy separate layers.

## Reconnaissance and map

`tracking.ts` shares physical cloak visibility across sensors, combat acquisition and enemy intelligence. Counter-tracking accumulates evidence only from detected ships moving with the observer, with stable bearing or a following position. Evidence, decoy waypoints and enemy destination stay on the authoritative Enemy. Evasion runs before every return/dock/decision branch and ends after 15 minutes without detected following evidence. Romulan sensing/exposure factors and cloak signatures are centralized.

SHADOW stores the owned ship's own last observed position and signal time. Shared contact knowledge can initiate a search but does not update a following ship that lacks physical sensor contact. Loss searches that frozen position for 20 minutes before holding. Cloak is initialized once per newly started SHADOW; a validated manual toggle persists for its current execution. Firing decloaks and energy drain is less than Veil core regeneration.

Unknown facilities have independent `SiteIntel`: observed coordinates, consecutive observation progress and lastSeen. The public `siteContacts` projection omits locationId, owner, name, inventories and destination. After ten consecutive game-minute observations an actual facility is confirmed. Docked/homeId alone never changes visibility. Public communications/history describe received declarations and observed events; weapon effects with hidden endpoints are filtered.

FRONTIER 0/0 has a fixed paired Wormhole to 0/12. Coordinate generation creates the unique Veil derelict, without generic recyclable wreck inventory. SURVEY and ASSIST_EVENT claim its one persistent fleet identity; a save flag and loss archive enforce uniqueness. That recovery event has no expiry.

Goods are Materials, Photon, Quantum and Special Finds; Credits are the budget. There is no upkeep scheduler or operating shortage state. Mine material storage is 3000. Colony income retains population/development/personnel/event factors. Dormant owned ships hold position, low ammunition reports only, and optional repair/rearm requires physical docking. Emergency combat disengagement has a local point and is cleared by Admiral work.

Map generation uses finite rejection sampling and deterministic fallback, with at most two systems and six secondary bodies per system. Authored sites and friendly facilities reserve layout space. Sector/System views suppress secondary bodies until system selection; local view expands them. Strategic co-located sites/facilities and docked fleets share markers. Label measurement uses loaded Antonio/Alibaba fonts, marker obstacles, multiple candidate positions and stable priority. `src/ui/map/palette.ts` owns faction/type meaning; alert decoration is independent.

## v9 command presentation and alerts

`selectedShipIds` is transient Renderer intent, separate from inspected `Selection` and formal fleet groups. Ordinary owned-ship clicks replace it; Ctrl clicks toggle membership. Non-ship inspection retains it and destroyed IDs are pruned. `ComposerRequest.shipIds` carries it into all task entry points, while explicit ship/group requests take precedence. Batch commands reuse validated `issueDirective.shipIds`; no temporary group is persisted. RETURN retains cargo; UNLOAD to `base` unloads the actual manifest.

The engine emits `shipTransited` only after physical traversal. Main forwards a public whitelist of owned ID, actual exit coordinate and tick through preload `onEvents`. Renderer camera following prioritizes the primary selected ship and ends on manual camera interaction or a new inspected object. It never needs a hidden destination, and overlays remain mounted.

`baseResources` is computed in main from the command budget, base inventory and held reservations; the UI cannot calculate or edit economic authority. `mapMarkers` contains only public dismissed/removable IDs. `dismissMapMarker` validates survey/event completion, remaining goods, rewards and active recovery before preserving the real entity but recording its display dismissal in the world save.

Sensor observation maintains private `contactAlerts` deduplication records. First detection, reacquisition after ten game minutes and first confirmed hostility create `newContact` pause reasons. The engine finishes the observed tick and stops the accelerated batch immediately. Public communications and contact projections provide the alert content; confirmation and orders do not resume the engine. Same-step observations form one modal/audio event. No deduplication ledger or faction intent crosses IPC.

Near survey completion creates the existing derelict event immediately. `ContextGuidance` reads public snapshot state to expose existing SURVEY, ASSIST_EVENT, HAUL, UNLOAD, build, upgrade and SHADOW entry points; it does not own a tutorial or mission system.

Console preferences version 2 stores independent text scale and interface zoom outside world saves. Root text defaults to 18px, all display rules use rem/em, and canvas measurements derive from computed text size. Electron applies zoom only when the value changes. Responsive decisions use available width divided by text size; oversized content wraps or scrolls, navigation expands and Inspector becomes a drawer. Local label candidates must connect to the nearest text edge within 4em; there is no screen-edge fallback.

## v10 production, occupation and migration

World saves are version 10. `legacy-v9/` freezes the previous validation contract, including its original ship capacities and action schema. Parsing v9 validates first, then migrates to the current schema. SaveStore stages every branch/head/day/failure snapshot under a new v10 directory before publishing its index; original v9 files remain unchanged.

`productionDiscountUnlocked` is set by actual survey/event/recovery acquisition and never derived from current stock during rendering. Main projects original and discounted prices, plus available/reserved inventory for every owned operational location. Build/manufacture/upgrade commands accept `locationId` (legacy default Dawn), and every IndustryJob stores its paying/producing base. Destruction cancels unpaid-output work permanently and records its loss, allowing an unfinished upgrade to be retried at another base. Galaxy capacity is independent of its initial loadout.

Defeated enemy bases/outposts have `occupation=ruined`. CAPTURE is an interruptible ship directive; successful on-site work transfers ownership to a secured ruin. startBaseRefit creates a physical construction inventory and retains the target location ID. Delivered material is consumed only when construction completes, and excess stock transfers to the rebuilt facility. Enemy home service and reinforcement must check faction ownership even though the historical home reference remains valid. Strategic upgrades remain shared across the command.

Ordinary wormholes use a seeded invertible affine permutation between nonadjacent sector blocks. Fixed Dawn endpoints remain authored. Migration reroutes stored ordinary endpoints; arrival materializes the reciprocal portal if the legacy endpoint had been forced outside the new natural occurrence distribution. Exit coordinates and seeds remain private. The renderer groups public markers at overview zoom and coarsens viewport grid cells instead of clipping the world to a fixed number of sectors.

The Inspector uses a scoped Chinese title mode and localized preset names. renamedEntityIds preserves player names verbatim, including names supplied at construction and names that resemble bilingual presets. Numeric colony data use existing LCARS segmented meters. Rearm previews account for reservations released by REPLACE and validate shared per-vessel quantities against all selected ships and total available stock. Queued directives reserve nothing until execution starts; they wait for future physical supply if stock is insufficient.
