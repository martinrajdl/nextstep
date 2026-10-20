'use client';

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ children, render, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" render={render || <Button variant="ghost" size="content" className="app-disclosure-trigger" />} {...props}>{children}<ChevronDown size={14} aria-hidden="true" className="app-disclosure-chevron" /></CollapsiblePrimitive.Trigger>
  );
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
