import React from 'react';

interface SubfeedIconProps {
  className?: string;
}

export function SubfeedIcon({ className = 'w-5 h-5' }: SubfeedIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="5"
        className="fill-zinc-950 dark:fill-zinc-100 mocha:fill-[#cdd6f4] glass:fill-white/90"
      />
      <rect
        x="6"
        y="6.5"
        width="4"
        height="4"
        rx="1"
        className="fill-[var(--sf-accent)]"
      />
      <rect
        x="11.75"
        y="7.25"
        width="6.25"
        height="2.5"
        rx="0.75"
        className="fill-zinc-100 dark:fill-zinc-950 mocha:fill-[#11111b] glass:fill-[#070a14]"
      />
      <rect
        x="6"
        y="12.25"
        width="12"
        height="2.25"
        rx="0.75"
        className="fill-zinc-100/85 dark:fill-zinc-950/85 mocha:fill-[#11111b]/85 glass:fill-[#070a14]/85"
      />
      <rect
        x="6"
        y="16"
        width="8.5"
        height="2.25"
        rx="0.75"
        className="fill-zinc-100/55 dark:fill-zinc-950/55 mocha:fill-[#11111b]/55 glass:fill-[#070a14]/55"
      />
    </svg>
  );
}
