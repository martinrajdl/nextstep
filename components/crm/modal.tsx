import AppButton from '@/components/app-button';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export default function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  dirty = false,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  dirty?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = () => {
    if (!dirty || window.confirm('Discard your unsaved changes?')) onClose();
  };
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return (
    <dialog
      className={`crm-dialog ${wide ? 'crm-dialog-wide' : ''} ${className}`}
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <AppButton
          type="button"
          className="crm-icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </AppButton>
      </header>
      {children}
    </dialog>
  );
}
