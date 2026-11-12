import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { isSolid, materialOf } from '@/lib/material';
import { useBackdropDismiss } from '@/components/ui/use-backdrop-dismiss';
/** In-app choice sheet: no native select/Android picker; Radix owns focus and Escape. */
export function PetChoice({ label, value, options, onChange }: {
  label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const settings = useApp(s => s.settings);
  const liquid = materialOf(settings) === 'liquid';
  const backdrop = useBackdropDismiss(() => setOpen(false));
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button type="button" className="pet-choice-trigger" aria-label={label}>
      {options.find(o => o[0] === value)?.[1]} <span aria-hidden="true">⌄</span>
    </button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={`pet-choice-backdrop ${liquid ? 'lq-dialog-scrim' : 'bg-fg/25'}`} {...backdrop} />
      <Dialog.Content className={`pet-choice-sheet ${liquid ? 'lq-dialog lq-dialog--sheet backdrop-blur-xl' : isSolid(settings) ? 'paper-sheet' : ''}`}
        onPointerDownOutside={e => e.preventDefault()} aria-describedby={undefined}>
        <div className="pet-choice-head"><Dialog.Title>{label}</Dialog.Title><Dialog.Close asChild><button type="button" aria-label={`关闭${label}`}>×</button></Dialog.Close></div>
        <div role="listbox" aria-label={label} className="pet-choice-options">
          {options.map(([id, title]) => <button type="button" key={id} role="option" aria-selected={value === id}
            onKeyDown={e => {
              if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
              e.preventDefault();
              const buttons = Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('button'));
              const index = buttons.indexOf(e.currentTarget);
              buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }} onClick={() => { onChange(id); setOpen(false); }}>
            <span>{title}</span><span aria-hidden="true">{value === id ? '✓' : ''}</span>
          </button>)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
