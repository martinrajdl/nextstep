import { Children, isValidElement, useCallback, useId, useRef, useState, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
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
  return <Tooltip.Root disabled={!label} open={open} onOpenChange={next => {
    // Native dialogs are in the top layer, so their tooltips belong inside them.
    if (next) setContainer(trigger.current?.closest('dialog') || null);
    setOpen(next);
  }}>
    <Tooltip.Trigger ref={setTrigger} aria-describedby={open ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby']} render={children} />
    <Tooltip.Portal container={container || undefined}>
      <Tooltip.Positioner side="bottom" sideOffset={6} collisionPadding={8} collisionBoundary={container || undefined} className="app-tooltip-positioner">
        <Tooltip.Popup id={id} role="tooltip" className="app-tooltip">{label}</Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}

export function AppTooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delay={450} closeDelay={80}>{children}</Tooltip.Provider>;
}

export default function AppButton({ tooltip, title, type = 'submit', ...props }: ComponentPropsWithRef<'button'> & { tooltip?: string }) {
  return <ButtonTooltip label={buttonTooltip({ ...props, tooltip, title })}>
    <ButtonPrimitive {...props} type={type} focusableWhenDisabled />
  </ButtonTooltip>;
}

export function AppLink({ tooltip, title, children, ...props }: ComponentPropsWithRef<'a'> & { tooltip?: string }) {
  return <ButtonTooltip label={buttonTooltip({ ...props, tooltip, title, children })}>
    <a {...props}>{children}</a>
  </ButtonTooltip>;
}
