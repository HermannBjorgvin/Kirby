import { cn, initials } from '../../lib/utils.js';

/** Initials avatar — deterministic hue per name, no remote images. */
function Avatar({
  name,
  className,
  size = 'sm',
}: {
  name: string;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const dims =
    size === 'xs'
      ? 'size-4 text-[8px]'
      : size === 'md'
      ? 'size-7 text-xs'
      : 'size-5 text-[9px]';
  return (
    <span
      aria-hidden
      title={name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none text-white',
        dims,
        className
      )}
      style={{ backgroundColor: `oklch(0.55 0.12 ${hue})` }}
    >
      {initials(name)}
    </span>
  );
}

export { Avatar };
