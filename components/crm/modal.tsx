import AppButton from '@/components/app-button';
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  const close = () => {
    if (!dirty || window.confirm('Discard your unsaved changes?')) onClose();
  };
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent
      className={`crm-dialog ${wide ? 'crm-dialog-wide' : ''} ${className}`}
      showCloseButton={false}
    >
      <header>
        <div>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
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
    </DialogContent>
    </Dialog>
  );
}
