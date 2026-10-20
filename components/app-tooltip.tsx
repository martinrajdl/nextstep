import { Children, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import '../app/tooltips.css';

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement<{ children?: ReactNode; 'aria-hidden'?: boolean | 'true' | 'false' }>(child) && child.props['aria-hidden'] !== true && child.props['aria-hidden'] !== 'true') {
      return textContent(child.props.children);
    }
    return '';
  }).join(' ').replace(/\s+/g, ' ').trim();
}

export function buttonTooltip({ tooltip, title, 'aria-label': label, children }: {
  tooltip?: string; title?: string; 'aria-label'?: string; children?: ReactNode;
}): string {
  return tooltip || title || label || textContent(children);
}

export function ButtonTooltip({ label, children }: { label: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement>(null);
  const setTrigger = useCallback((element: HTMLElement | null) => { trigger.current = element; }, []);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // Escape dismisses the innermost help before its containing dialog or menu.
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', dismiss, true);
    return () => window.removeEventListener('keydown', dismiss, true);
  }, [open]);
  return <Tooltip disabled={!label} open={open} onOpenChange={next => {
    // Keep tooltips inside the active modal focus scope.
    if (next) setContainer(trigger.current?.closest<HTMLElement>('[role=dialog], [role=alertdialog]') || null);
    setOpen(next);
  }}>
    <TooltipTrigger ref={setTrigger} aria-describedby={open ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby']} render={children} />
    <TooltipContent container={container || undefined} side="bottom" sideOffset={6} collisionPadding={8} collisionBoundary={container || undefined} positionerClassName="app-tooltip-positioner" id={id} role="tooltip" aria-hidden={!open} className="app-tooltip">{label}</TooltipContent>
  </Tooltip>;
}

export function AppTooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipProvider delay={450} closeDelay={80}>{children}</TooltipProvider>;
}
