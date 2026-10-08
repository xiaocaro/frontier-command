import { advanceTrade } from './trade';
import { advanceEvents } from './world-events';
import { FIXED_DELTA, TICKS_PER_DAY, gameCalendar } from './clock';
import { createWorld } from './data';
import * as commands from './command-system';
import * as projection from './projection';
import { advanceShip } from './execution';
import { advanceEnemy, advanceFactions } from './threats';
import { advanceEconomy } from './services';
import { updateSensors } from './sensors';
import { applyDamage, fire } from './combat';
import type {
  Action,
  AgentControllerPort,
  Beam,
  CriticalReason,
  Location,
  Ship,
  SimulationEvent,
  WorldState,
} from './types';
export { FIXED_DELTA } from './clock';
export { dist } from './navigation';
export class SimulationEngine {
  state: WorldState;
  pending: CriticalReason[] = [];
  pendingEvents: SimulationEvent[] = [];
  constructor(world = createWorld()) {
    this.state = structuredClone(world);
  }
  get base() {
    return this.state.locations.find((l) => l.id === 'base')!;
  }
  random = () => {
    this.state.seed = (Math.imul(this.state.seed, 1664525) + 1013904223) >>> 0;
    return this.state.seed / 4294967296;
  };
  log(text: string, level: 'info' | 'success' | 'warning' | 'danger' = 'info') {
    const w = this.state;
    w.logs.push({ id: w.nextLog++, time: w.time, text, level });
    if (w.logs.length > 180) w.logs.shift();
  }
  report(
    text: string,
    entityId: string | null,
    priority: 'normal' | 'high' | 'urgent' = 'normal',
    category: 'request' | 'report' | 'threat' | 'decision' = 'report',
  ) {
    const w = this.state;
    w.communications.push({
      id: w.nextComms++,
      time: w.time,
      text,
      entityId,
      priority,
      category,
      read: false,
    });
    if (w.communications.length > 100) w.communications.shift();
    this.log(text, priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'info');
  }
  record(kind: string, text: string, entityId: string | null) {
    this.state.history.push({
      id: this.state.nextHistory++,
      time: this.state.time,
      kind,
      text,
      entityId,
    });
    this.report(text, entityId);
  }
  critical(kind: CriticalReason['kind'], entityId: string, message: string) {
    if (!this.pending.some((r) => r.kind === kind && r.entityId === entityId))
      this.pending.push({ kind, entityId, message, tick: this.state.tick, time: this.state.time });
  }
  finishCritical(): SimulationEvent[] {
    if (!this.pending.length) return [];
    const reasons = this.pending.splice(0);
    this.state.paused = true;
    this.state.pauseReasons.push(...reasons);
    return [{ type: 'criticalPause', reasons: structuredClone(reasons) }];
  }
  isCommandLost() {
    return this.state.status === 'commandLost';
  }
  validate = commands.validate.bind(this);
  dispatchCommand = commands.dispatchCommand.bind(this);
  submitAction = commands.submitAction.bind(this);
  snapshot = projection.snapshot.bind(this);
  getObservation = projection.getObservation.bind(this);
  controllerPort(operatorId: string): AgentControllerPort {
    return Object.freeze({
      getObservation: () => this.getObservation(operatorId),
      submitAction: (action: Action) => this.submitAction(operatorId, action),
    });
  }
  hit = (target: Ship | Location, amount: number, attacker?: Ship) =>
    applyDamage(this, target, amount, attacker);
  fire = (
    s: Ship,
    t: Ship | Location,
    disable?: 'engines' | 'weapons' | 'suppression' | 'warning',
  ) => fire(this, s, t, disable);
  berth(s: Ship) {
    const i = this.state.ships.findIndex((x) => x.id === s.id);
    return { x: this.base.x + ((i % 8) - 3.5) * 24, y: this.base.y + 40 + Math.floor(i / 8) * 22 };
  }
  complete(s: Ship, text: string, failed = false) {
    const old = s.current;
    s.current = null;
    s.tracking = null;
    s.path = [];
    s.status = 'idle';
    if (old)
      this.record(
        failed ? 'actionFailed' : 'action',
        s.name + ' / ' + old.action.type + ' / ' + text,
        s.id,
      );
    const next = s.suspended.pop() ?? s.queue.shift();
    if (next) {
      const valid = commands.validateContinuation(this, s, next);
      if (valid.ok) {
        s.current = next;
        s.path = [];
        s.status = 'active';
        next.note = '接续：' + text;
      } else {
        s.current = next;
        this.complete(s, '目标无法接续：' + valid.reason, true);
      }
    }
    // Lv3 decision triggers (docs/lv3/02-domain-model.md §14). `complete()` is the single funnel for
    // every directive that ends — ~45 call sites across execution/world-events call it — so one push
    // here covers all of them. These ride the transient `pendingEvents` channel and never enter
    // `state`, which is what keeps `tests/architecture.test.ts`'s replay assertion true (C-16).
    if (old)
      this.pendingEvents.push({
        type: 'agentTrigger',
        trigger: failed
          ? { kind: 'directive-failed', shipId: s.id, directiveId: old.id, reason: text }
          : { kind: 'directive-completed', shipId: s.id, directiveId: old.id },
      });
    if (!next) this.pendingEvents.push({ type: 'agentTrigger', trigger: { kind: 'ship-idle', shipId: s.id } });
  }
  step(fixedDelta = FIXED_DELTA): SimulationEvent[] {
    if (fixedDelta !== FIXED_DELTA) throw Error('Simulation requires fixed 0.1 game-minute steps');
    const w = this.state;
    if (w.paused || this.isCommandLost()) return [];
    w.tick++;
    w.time = w.tick / 10;
    const events: SimulationEvent[] =
      w.tick % TICKS_PER_DAY === 0
        ? [{ type: 'dayBoundary', day: gameCalendar(w.tick).day, tick: w.tick, time: w.time }]
        : [];
    w.beams = w.beams.filter((b) => b.expires > w.time);
    if (w.tick % 10 === 0) updateSensors(this);
    if (this.pending.some((r) => r.kind === 'newContact'))
      return [...events, ...this.pendingEvents.splice(0), ...this.finishCritical()];
    advanceEconomy(this, fixedDelta);
    for (const s of [...w.ships]) {
      if (this.isCommandLost()) break;
      advanceShip(this, s, fixedDelta);
    }
    for (const s of [...w.enemies]) {
      if (this.isCommandLost()) break;
      advanceEnemy(this, s, fixedDelta);
    }
    advanceTrade(this, fixedDelta);
    advanceFactions(this, fixedDelta);
    advanceEvents(this, fixedDelta);
    return [...events, ...this.pendingEvents.splice(0), ...this.finishCritical()];
  }
  advanceFrame(afterStep?: (events: SimulationEvent[], state: WorldState) => void) {
    const events: SimulationEvent[] = [];
    const speed = this.state.speed;
    for (let i = 0; i < speed && !this.state.paused; i++) {
      const next = this.step();
      afterStep?.(next, this.state);
      events.push(...next);
    }
    return events;
  }
  beam(attacker: Ship | Location, target: Ship | Location, weapon: string) {
    const b: Beam = {
      from: { x: attacker.x, y: attacker.y },
      to: { x: target.x, y: target.y },
      enemy:
        'factionId' in attacker
          ? attacker.factionId !== 'starfleet'
          : attacker.owner !== 'starfleet',
      weapon,
      expires: this.state.time + 0.4,
    };
    this.state.beams.push(b);
  }
}
