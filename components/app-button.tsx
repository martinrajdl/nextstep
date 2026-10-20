import type { ComponentProps, ComponentPropsWithRef } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonTooltip, buttonTooltip } from '@/components/app-tooltip';
export { AppTooltipProvider, ButtonTooltip, buttonTooltip } from '@/components/app-tooltip';

// Product-specific layouts share the same shadcn button and tooltip behavior.
export default function AppButton({ type = 'submit', variant = 'ghost', size = 'content', ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} type={type} variant={variant} size={size} />;
}

export function AppLink({ tooltip, title, children, ...props }: ComponentPropsWithRef<'a'> & { tooltip?: string }) {
  return <ButtonTooltip label={buttonTooltip({ ...props, tooltip, title, children })}>
    <a {...props}>{children}</a>
  </ButtonTooltip>;
}
