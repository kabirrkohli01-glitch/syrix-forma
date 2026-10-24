import { cn } from '@/lib/utils';

// Soft, slow-drifting blurred color blobs in the organisation's blue family — replaces the old dotted
// interactive grid. Keyframe (`gradient-drift`, styles/globals.css) only ever animates
// `transform`, never opacity, so a blob that somehow doesn't animate just sits still and fully
// visible rather than disappearing — a deliberately safer failure mode than an entrance fade.
export function GradientMesh({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
      <div
        className='gradient-mesh-blob absolute -top-1/4 -left-1/4 size-3/5 rounded-full bg-[oklch(0.45_0.16_258)] opacity-40 blur-3xl'
        style={{ animation: 'gradient-drift 22s ease-in-out infinite' }}
      />
      <div
        className='gradient-mesh-blob absolute top-1/3 -right-[15%] size-[55%] rounded-full bg-[oklch(0.6_0.14_240)] opacity-30 blur-3xl'
        style={{ animation: 'gradient-drift 26s ease-in-out infinite', animationDelay: '-8s' }}
      />
      <div
        className='gradient-mesh-blob absolute -bottom-1/5 left-1/4 size-1/2 rounded-full bg-[oklch(0.72_0.13_258)] opacity-25 blur-3xl'
        style={{ animation: 'gradient-drift 30s ease-in-out infinite', animationDelay: '-14s' }}
      />
    </div>
  );
}
