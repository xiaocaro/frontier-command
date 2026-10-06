import { autonomousFire } from './execution';
import type { SimulationEngine } from './engine';
import type { CargoKind } from './types';
import { TRADE_PRICES } from './definitions/frontier';
import { available, deposit, space } from './inventory';
import { move, dist } from './navigation';
import { regenerate } from './combat';
export function tradeReason(
  e: SimulationEngine,
  direction: 'buy' | 'sell',
  k: CargoKind,
  n: number,
) {
  const t = e.state.trade,
    price = TRADE_PRICES[k][direction] * n;
  if (!e.state.civilians.some((s) => s.hull > 0)) return '商船已损失，无法交付';
  if (direction === 'buy')
    return k === 'specialFinds'
      ? '特殊发现不可购买'
      : t.stock[k] < n
        ? '后方真实库存不足'
        : e.state.resources.credits < price
          ? '预算不足'
          : !e.state.civilians.some((s) => s.hull > 0)
            ? '商船已损失，无法交付'
            : null;
  return available(e.state, 'base', k) < n
    ? '基地可用库存不足'
    : t.credits < price
      ? '交易方资金不足'
      : space(t, k) -
            t.orders
              .filter(
                (o) =>
                  o.direction === 'sell' &&
                  o.cargoKind === k &&
                  ['waiting', 'loading', 'delivery'].includes(o.state),
              )
              .reduce((v, o) => v + o.amount - o.delivered, 0) <
          n
        ? '交易方仓储不足'
        : null;
}
export function orderTrade(
  e: SimulationEngine,
  direction: 'buy' | 'sell',
  k: CargoKind,
  n: number,
) {
  const w = e.state,
    t = w.trade,
    price = TRADE_PRICES[k][direction] * n,
    id = 'trade-' + w.nextId++;
  if (direction === 'sell') {
    e.base.stock[k] -= n;
    t.credits -= price;
    w.resources.credits += price;
    t.orders.push({
      id,
      direction,
      cargoKind: k,
      amount: n,
      delivered: 0,
      loaded: 0,
      price,
      state: 'waiting',
      carrierId: null,
    });
    e.record('trade', '出口 ' + n + ' ' + k + '，实物所有权转移', id);
  } else {
    t.stock[k] -= n;
    t.credits += price;
    w.resources.credits -= price;
    t.orders.push({
      id,
      direction,
      cargoKind: k,
      amount: n,
      delivered: 0,
      loaded: 0,
      price,
      state: 'waiting',
      carrierId: null,
    });
    e.record('trade', '付费进口 ' + n + ' ' + k + '，等待真实商船交付', id);
  }
}
export function advanceTrade(e: SimulationEngine, dt: number) {
  const w = e.state,
    t = w.trade;
  for (const s of [...w.civilians]) {
    regenerate(s, w.time, dt);
    autonomousFire(e, s);
    if (s.phase === 'idle') {
      const order = t.orders.find((o) => o.state === 'waiting');
      if (order) {
        order.carrierId = s.id;
        order.state = 'loading';
        s.orderId = order.id;
        s.phase = 'loading';
        s.work = 0;
      }
    }
    const o = t.orders.find((o) => o.id === s.orderId);
    if (s.phase === 'loading' && o) {
      const origin = o.direction === 'buy' ? t.depot : e.base;
      if (dist(s, origin) > 8) {
        move(s, origin, dt);
        continue;
      }
      s.work += dt;
      if (s.work >= 2) {
        const n = Math.min(o.amount - o.loaded, 600);
        s.cargo[o.cargoKind] = n;
        o.loaded += n;
        s.phase = 'delivery';
        o.state = 'delivery';
        s.work = 0;
      }
    } else if (s.phase === 'delivery' && o) {
      const destination = o.direction === 'buy' ? e.base : t.depot;
      if (dist(s, destination) > 12) {
        move(s, destination, dt);
        continue;
      }
      const n = deposit(o.direction === 'buy' ? e.base : t, o.cargoKind, s.cargo[o.cargoKind]);
      s.cargo[o.cargoKind] -= n;
      o.delivered += n;
      if (!s.cargo[o.cargoKind]) {
        if (o.delivered >= o.amount) {
          o.state = 'complete';
          e.record('trade', '贸易实际交付 ' + o.delivered + ' ' + o.cargoKind, o.id);
        } else if (o.loaded < o.amount) o.state = 'waiting';
        else {
          o.state = 'lost';
          e.record('trade', '贸易货损：实际交付 ' + o.delivered + '/' + o.amount, o.id);
        }
        s.phase = 'return';
        s.orderId = null;
      }
    } else if (s.phase === 'return' && move(s, t.depot, dt)) s.phase = 'idle';
  }
}
