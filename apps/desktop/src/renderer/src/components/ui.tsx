import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, CircleAlert, CircleCheck, FileText, Film, File, Image, Info, Music, Package, X } from 'lucide-react';
import type { Category, DownloadItem } from '../../../shared/types';
import { useApp } from '../state';
import { useI18n, type MessageKey } from '../i18n';

export function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  size,
}: {
  title: string;
  icon?: ReactNode;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'lg';
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const prevActiveRef = useRef<Element | null>(null);

  useEffect(() => {
    prevActiveRef.current = document.activeElement;

    // Focus first interactive element or modal container
    const el = modalRef.current;
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        el.focus();
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prevActiveRef.current && (prevActiveRef.current as HTMLElement).focus) {
        (prevActiveRef.current as HTMLElement).focus();
      }
    };
  }, [onClose]);

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={modalRef}
        tabIndex={-1}
        className={`modal ${size ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', damping: 24, stiffness: 320 }}
      >
        <div className="modal-head">
          {icon}
          <h2>{title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </motion.div>
    </motion.div>
  );
}

export interface MenuEntry {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return (
    <motion.div
      className="context-menu"
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', damping: 24, stiffness: 380 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </motion.div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.9 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            className={`toast ${t.kind}`}
          >
            {t.kind === 'success' ? (
              <CircleCheck className="kind" size={18} />
            ) : t.kind === 'error' ? (
              <CircleAlert className="kind" size={18} />
            ) : (
              <Info className="kind" size={18} />
            )}
            <div className="grow">{t.text}</div>
            {t.action && (
              <button
                className="btn sm"
                onClick={() => {
                  t.action?.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="btn ghost sm icon" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const CATEGORY_ICONS: Record<Category, typeof File> = {
  video: Film,
  music: Music,
  documents: FileText,
  compressed: Archive,
  programs: Package,
  images: Image,
  other: File,
};

export function CategoryIcon({ category, size = 16 }: { category: Category; size?: number }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon size={size} />;
}

export function FileIcon({ item }: { item: DownloadItem }) {
  const [broken, setBroken] = useState(false);
  const thumb = item.media?.thumbnailUrl;
  useEffect(() => setBroken(false), [thumb]);
  return (
    <div className={`file-icon ${item.category}`}>
      {thumb && !broken ? (
        <img src={thumb} alt="" loading="lazy" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
      ) : (
        <CategoryIcon category={item.category} size={17} />
      )}
    </div>
  );
}

export function ProgressBar({
  value,
  state,
  indeterminate,
}: {
  value: number;
  state?: 'paused' | 'done' | 'error';
  indeterminate?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`progress ${state ?? ''} ${indeterminate ? 'indeterminate' : ''}`}
    >
      {indeterminate ? (
        <div style={{ width: `${pct}%` }} />
      ) : (
        <motion.div
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', damping: 26, stiffness: 200 }}
        />
      )}
    </div>
  );
}

/** Weekday chips for a schedule. An empty selection means every day. */
export function DayPicker({ value, onChange }: { value: number[] | undefined; onChange(days: number[]): void }) {
  const { t } = useI18n();
  const selected = value ?? [];
  const toggle = (day: number) =>
    onChange(selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day].sort((a, b) => a - b));
  return (
    <div className="segmented" role="group" aria-label={t('sched.days')} style={{ flexWrap: 'wrap' }}>
      <button type="button" className={selected.length === 0 ? 'active' : ''} aria-pressed={selected.length === 0} onClick={() => onChange([])}>
        {t('sched.everyDay')}
      </button>
      {[0, 1, 2, 3, 4, 5, 6].map((day) => (
        <button
          key={day}
          type="button"
          className={selected.includes(day) ? 'active' : ''}
          aria-pressed={selected.includes(day)}
          onClick={() => toggle(day)}
        >
          {t(`sched.day.${day}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Thumb({ src, className, square }: { src?: string; className?: string; square?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <div className={`thumb ${square ? 'square' : ''} ${className ?? ''}`} />;
  return (
    <img
      className={`thumb ${square ? 'square' : ''} ${className ?? ''}`}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}
