/**
 * Component class recipes, transcribed from the app-base `@app/ui` primitives (shadcn
 * "new-york" style on the token contract). They return class strings for server-rendered
 * markup; there is no component runtime here. Keep every class literal complete so the
 * Tailwind content scan finds it: compose variants with cva, never by string
 * concatenation.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class lists; later Tailwind utilities win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline:
          'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'h-auto rounded-none px-0 py-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3.5',
        lg: 'h-11 px-6 text-base',
        icon: 'h-10 w-10 rounded-md',
        'icon-sm': 'h-8 w-8 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
export type ButtonVariants = VariantProps<typeof button>;

export const badge = cva(
  'inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-muted-foreground',
        surface: 'border-border bg-card text-foreground',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export type BadgeVariants = VariantProps<typeof badge>;

export const card = 'rounded-xl border border-border bg-card text-card-foreground shadow-soft';
export const cardHeader = 'flex flex-col gap-2 p-6';
export const cardTitle = 'text-lg font-semibold tracking-tight';
export const cardDescription = 'text-sm leading-6 text-muted-foreground';
export const cardContent = 'px-6 pb-6';
export const cardFooter = 'flex items-center gap-3 px-6 pb-6';

export const input =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

/**
 * A native <select> styled like the input. Render it inside `nativeSelectWrapper` with
 * `nativeSelectChevron` after it: the browser's own arrow is suppressed and the lucide
 * chevron sits where the shadcn select puts it.
 */
export const nativeSelect = cn(input, 'cursor-pointer appearance-none pr-9');
export const nativeSelectWrapper = 'relative';
export const nativeSelectChevron =
  'pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground';

export const textarea =
  'flex min-h-[200px] w-full resize-y rounded-md border border-input bg-muted px-3.5 py-3 font-mono text-[0.84rem] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export const label = 'text-sm font-medium text-foreground';

export const alert = cva(
  'relative w-full rounded-lg border p-4 text-sm [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground [&>svg]:text-foreground',
        info: 'border-primary/30 bg-primary/10 text-foreground [&>svg]:text-primary',
        destructive:
          'border-destructive/40 bg-destructive/10 text-foreground [&>svg]:text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export type AlertVariants = VariantProps<typeof alert>;

export const separator = 'h-px w-full shrink-0 bg-border/80';

/** Inline code and preformatted blocks, used by both the report and the hosted pages. */
export const codeInline =
  'rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground';
export const codeBlock =
  'overflow-auto rounded-lg border border-border bg-muted p-3.5 font-mono text-[0.84rem] leading-relaxed text-foreground';
