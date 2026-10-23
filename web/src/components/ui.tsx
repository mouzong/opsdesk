import { X } from 'lucide-react';
import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ENVIRONMENT_LABELS, type Environment } from '../../../shared/constants';
import { useStore } from '../store';

/* ------------------------------------------------------------------ badges */

export function EnvBadge({ env, compact }: { env: Environment; compact?: boolean }) {
  return (
    <span className={`env env-${env}`} title={ENVIRONMENT_LABELS[env]}>
      {compact && env === 'production' ? 'PROD' : ENVIRONMENT_LABELS[env]}
    </span>
  );
}

/* ------------------------------------------------------------------ modal */

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  description?: string;
}

export function Modal({ title, onClose, children, footer, wide, description }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dlg = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (dlg && !dlg.open) dlg.showModal();
    return () => {
      if (dlg?.open) dlg.close();
      previous?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) closeRef.current();
      }}
    >
      <div className="modal-panel">
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {description && <p id={descId} className="modal-desc">{description}</p>}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmModal(props: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>Cancel</button>
          <button type="button" className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm} disabled={props.busy}>
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-text">{props.message}</div>
    </Modal>
  );
}

/* --------------------------------------------------------------- popovers */

interface Pos { top?: number; bottom?: number; left?: number; right?: number; maxHeight: number }

function computePos(trigger: HTMLElement, align: 'start' | 'end'): Pos {
  const r = trigger.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const above = r.top;
  const flip = below < 260 && above > below;
  const pos: Pos = { maxHeight: Math.max(160, (flip ? above : below) - 16) };
  if (flip) pos.bottom = window.innerHeight - r.top + 6;
  else pos.top = r.bottom + 6;
  if (align === 'end') pos.right = Math.max(8, window.innerWidth - r.right);
  else pos.left = Math.max(8, Math.min(r.left, window.innerWidth - 280));
  return pos;
}

function usePopover(align: 'start' | 'end') {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open && triggerRef.current) setPos(computePos(triggerRef.current, align));
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const style: CSSProperties | undefined = pos ? { ...pos } : undefined;
  return { open, setOpen, close, triggerRef, panelRef, style };
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function Menu({ label, trigger, items, align = 'end', className }: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  className?: string;
}) {
  const p = usePopover(align);
  const menuId = useId();

  useEffect(() => {
    if (p.open && p.style) p.panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [p.open, p.style, p.panelRef]);

  const onKey = (e: ReactKeyboardEvent) => {
    const els = [...(p.panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.close(); }
    else if (e.key === 'Tab') p.close(false);
  };

  return (
    <>
      <button
        ref={p.triggerRef}
        type="button"
        className={className ?? 'icon-btn'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={p.open}
        aria-controls={p.open ? menuId : undefined}
        onClick={(e) => { e.stopPropagation(); p.setOpen(!p.open); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !p.open) { e.preventDefault(); p.setOpen(true); } }}
      >
        {trigger}
      </button>
      {p.open && createPortal(
        <div ref={p.panelRef} id={menuId} role="menu" aria-label={label} className="popover menu" style={p.style} onKeyDown={onKey}>
          {items.map((it, i) => (
            <div key={i} role="none">
              {it.separatorBefore && <div className="menu-sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={`menu-item${it.danger ? ' danger' : ''}`}
                disabled={it.disabled}
                onClick={() => { p.close(false); it.onSelect(); }}
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function Popover({ label, trigger, children, active, align = 'start' }: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  active?: boolean;
  align?: 'start' | 'end';
}) {
  const p = usePopover(align);
  const panelId = useId();
  return (
    <>
      <button
        ref={p.triggerRef}
        type="button"
        className={`btn btn-ghost chip-btn${active ? ' is-active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        aria-controls={p.open ? panelId : undefined}
        onClick={() => p.setOpen(!p.open)}
      >
        {trigger}
      </button>
      {p.open && createPortal(
        <div
          ref={p.panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          className="popover panel"
          style={p.style}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.close(); } }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ------------------------------------------------------------------ toasts */

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- form helpers */

export function Field({ label, error, hint, children, htmlFor }: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="field-hint" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${htmlFor}-error`} role="alert">{error}</p>}
    </div>
  );
}

export function useFocusOnMount<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
