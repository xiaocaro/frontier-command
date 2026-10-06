import type { Cost, ReadonlyDeep } from '../../engine/types';
export function ProductionPrice({
  original,
  actual,
  discounted,
  amount = 1,
}: {
  original: ReadonlyDeep<Cost>;
  actual: ReadonlyDeep<Cost>;
  discounted: boolean;
  amount?: number;
}) {
  const text = (price: ReadonlyDeep<Cost>) =>
    `${price.credits * amount} 预算／${price.materials * amount} 材料`;
  return (
    <p className="production-price" aria-label="生产费用">
      {discounted && <del>原价 {text(original)}</del>}
      <strong>实付 {text(actual)}</strong> ·{' '}
      {discounted ? '特殊发现永久五折' : '首次取得特殊发现后永久五折'}
    </p>
  );
}
