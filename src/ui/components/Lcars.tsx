import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  Ref,
} from 'react';
import { useLcars } from '../lcars/LcarsProvider';
import type { AudioCue } from '../lcars/audio-manager';
import { usePanelFocus } from '../lcars/usePanelFocus';
import { ChineseDisplay, chineseText } from '../localization';
import { Children, useContext } from 'react';
import { bilingualTitle } from './bilingual';
export type LcarsTone = 'primary' | 'secondary' | 'danger' | 'orange' | 'almond';
export function LcarsButton({
  tone = 'primary',
  shape = 'pill',
  sound = 'none',
  className = '',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: LcarsTone;
  shape?: 'pill' | 'flat' | 'rail' | 'text';
  sound?: AudioCue | 'none';
}) {
  const { audio } = useLcars();
  return (
    <button
      type="button"
      className={`lcars-button ${tone} shape-${shape} ${className}`}
      {...props}
      onClick={(event) => {
        if (sound !== 'none') audio.play(sound);
        onClick?.(event);
      }}
    />
  );
}
export function LcarsElbow({
  orientation = 'lower',
  className = '',
  children,
}: {
  orientation?: 'upper' | 'lower';
  className?: string;
  children?: ReactNode;
}) {
  return <div className={`lcars-elbow elbow-${orientation} ${className}`}>{children}</div>;
}
export function LcarsBar({
  variant = 'upper',
  className = '',
}: {
  variant?: 'upper' | 'lower';
  className?: string;
}) {
  return (
    <div className={`lcars-bar-panel bar-${variant} ${className}`} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} />
      ))}
    </div>
  );
}
export function LcarsTextBar({
  children,
  className = '',
  literal = false,
}: {
  children: ReactNode;
  className?: string;
  literal?: boolean;
}) {
  const chinese = useContext(ChineseDisplay);
  const parts = Children.toArray(children);
  const content = parts.every((p) => typeof p === 'string' || typeof p === 'number')
    ? literal
      ? parts.join('')
      : chinese
        ? chineseText(parts.join(''))
        : bilingualTitle(parts.join(''))
    : children;
  return (
    <div className={`lcars-text-bar ${className}`}>
      <span title={typeof content === 'string' ? content : undefined}>{content}</span>
    </div>
  );
}
export function LcarsPanel({
  children,
  title,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <section className={`lcars-panel ${className}`}>
      {title && <LcarsTextBar>{title}</LcarsTextBar>}
      {children}
    </section>
  );
}
export function LcarsField(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={`lcars-field ${props.className ?? ''}`} />;
}
export function LcarsMeter({
  label,
  value,
  max,
  danger = false,
  decimals = 0,
}: {
  label: string;
  value: number;
  max: number;
  danger?: boolean;
  decimals?: number;
}) {
  return (
    <div className={'meter' + (danger ? ' meter-danger' : '')}>
      <span>
        {label}
        <b>
          {Number(value.toFixed(decimals))} / {max}
        </b>
      </span>
      <progress aria-label={label} value={value} max={max} />
    </div>
  );
}
export function LcarsFrame({
  title,
  children,
  onClose,
  className = '',
  panelRef,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  panelRef?: Ref<HTMLElement>;
}) {
  return (
    <section {...props} ref={panelRef} tabIndex={-1} className={`lcars-frame ${className}`}>
      <div className="frame-rail" aria-hidden="true">
        <LcarsElbow />
        <span>
          LCARS
          <br />
          COMMAND
        </span>
      </div>
      <div className="frame-body">
        <LcarsBar variant="lower" />
        <div className="panel-heading">
          <LcarsTextBar className="section-title">{title}</LcarsTextBar>
          {onClose && (
            <LcarsButton
              tone="secondary"
              sound="navigation"
              className="close-control"
              onClick={onClose}
              aria-label={
                props['aria-label'] === 'Admiral 指令'
                  ? '关闭行动编辑'
                  : props['aria-label']?.endsWith('工作面板')
                    ? '关闭管理面板'
                    : '关闭面板'
              }
            >
              CLOSE
            </LcarsButton>
          )}
        </div>
        <div className="panel-content">{children}</div>
        <LcarsBar className="frame-bottom" />
      </div>
    </section>
  );
}
export function LcarsDrawer({
  title,
  label,
  onClose,
  children,
  className = '',
}: {
  title: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = usePanelFocus(onClose, false);
  return (
    <LcarsFrame
      panelRef={ref}
      role="dialog"
      aria-label={label}
      title={title}
      onClose={onClose}
      className={`management-drawer ${className}`}
    >
      {children}
    </LcarsFrame>
  );
}
export function LcarsDialog({
  title,
  children,
  label,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  label: string;
  onClose?: () => void;
  className?: string;
}) {
  const ref = usePanelFocus(onClose);
  return (
    <div className="composer-backdrop">
      <LcarsFrame
        title={title}
        panelRef={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClose={onClose}
        className={`lcars-dialog ${className}`}
      >
        {children}
      </LcarsFrame>
    </div>
  );
}
