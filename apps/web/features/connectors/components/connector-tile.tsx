import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { ConnectorCatalogueEntry } from '@/config/connectors';

/**
 * A service's mark on a brand-coloured tile.
 *
 * Tabler's glyphs are monochrome, so the recognisable part has to be the colour: the tile carries
 * the brand's own, at low opacity behind a full-strength glyph, which stays legible in both
 * themes without needing a second asset for each. Nothing is fetched — see the note in
 * components/icons.tsx.
 */
export function ConnectorTile({
  entry,
  className
}: {
  entry: Pick<ConnectorCatalogueEntry, 'icon' | 'tint' | 'name'>;
  className?: string;
}) {
  const Icon = Icons[entry.icon] ?? Icons.settings;

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5',
        className
      )}
      style={{ backgroundColor: `${entry.tint}1f`, color: entry.tint }}
    >
      <Icon />
    </span>
  );
}
