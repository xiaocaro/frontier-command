import { capabilities } from '../engine/capabilities';
import { dist } from '../engine/navigation';
import { useState } from 'react';
import type { CargoKind, Snapshot } from '../engine/types';
import { GOODS } from '../engine/types';
import { TRADE_PRICES } from '../engine/definitions/frontier';
import type { CommandSender } from './types';
import { LcarsTextBar, LcarsField, LcarsButton } from './components/Lcars';
import { GOODS_LABELS } from './format';
export function TradeView({ world, command }: { world: Snapshot; command: CommandSender }) {
  const [kind, setKind] = useState<CargoKind>('materials'),
    [amount, setAmount] = useState(20);
  return (
    <>
      <LcarsTextBar>Federation Exchange 实物贸易</LcarsTextBar>
      <p>进口由有限后方库存与真实商船交付。当前商船 {world.civilians.length} 艘。</p>
      <LcarsField>
        贸易货物
        <select
          aria-label="贸易货物"
          value={kind}
          onChange={(e) => setKind(e.target.value as CargoKind)}
        >
          {GOODS.map((k) => (
            <option key={k} value={k}>
              {GOODS_LABELS[k]} · 后方库存 {Math.floor(world.trade.stock[k])}
            </option>
          ))}
        </select>
      </LcarsField>
      <LcarsField>
        贸易数量
        <input
          aria-label="贸易数量"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </LcarsField>
      <p>
        进口 {TRADE_PRICES[kind].buy * amount} Credits · 出口 {TRADE_PRICES[kind].sell * amount}{' '}
        Credits
      </p>
      <div className="inline-actions">
        <LcarsButton
          disabled={kind === 'specialFinds'}
          onClick={() => command({ type: 'tradeStock', direction: 'buy', cargoKind: kind, amount })}
        >
          购买并运输到 Dawn
        </LcarsButton>
        <LcarsButton
          onClick={() =>
            command({ type: 'tradeStock', direction: 'sell', cargoKind: kind, amount })
          }
        >
          出售基地实物
        </LcarsButton>
      </div>
      {world.trade.orders.map((o) => {
        const carrier = world.civilians.find((s) => s.id === o.carrierId);
        const target =
          o.direction === 'buy' ? world.locations.find((l) => l.id === 'base')! : world.trade.depot;
        const eta = carrier
          ? Math.ceil(
              dist(carrier, target) / capabilities(carrier).warp +
                (o.state === 'loading' ? Math.max(0, 2 - carrier.work) : 0),
            )
          : null;
        return (
          <p key={o.id}>
            {GOODS_LABELS[o.cargoKind]} ·{' '}
            {
              {
                waiting: '等待商船',
                loading: '后方装载',
                delivery: '运输中',
                complete: '交付完成',
                lost: '运输损失',
              }[o.state]
            }{' '}
            · 实际交付 {o.delivered}/{o.amount}
            {o.carrierId &&
              world.civilians.find((s) => s.id === o.carrierId) &&
              ' · 商船正在真实航行'}
            {eta !== null &&
              o.state !== 'complete' &&
              o.state !== 'lost' &&
              ` · 最短 ETA ${eta} 分钟（满仓时等待）`}
          </p>
        );
      })}
    </>
  );
}
