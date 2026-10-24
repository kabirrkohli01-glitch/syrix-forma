import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/**
 * The signed-in person as the Hub knows them.
 *
 * `name` is the Hub's own display name (`lib/db/display-name.ts`), not Clerk's
 * `fullName`. Clerk holds the account-of-record identity; what the app calls
 * someone is a Hub setting, and the two are allowed to differ. Only the avatar
 * image still comes from Clerk, because the Hub has no upload of its own.
 */
interface UserAvatarProfileProps {
  className?: string;
  showInfo?: boolean;
  name: string;
  email?: string;
  imageUrl?: string;
}

/** First letter of the first two words — "Kabir Kohli" -> "KK", "Kabir" -> "KA". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function UserAvatarProfile({
  className,
  showInfo = false,
  name,
  email,
  imageUrl
}: UserAvatarProfileProps) {
  return (
    <div className='flex items-center gap-2'>
      <Avatar className={className}>
        <AvatarImage src={imageUrl || ''} alt='' />
        <AvatarFallback className='rounded-lg'>{initialsOf(name)}</AvatarFallback>
      </Avatar>

      {showInfo && (
        <div className='grid flex-1 text-left text-sm leading-tight'>
          <span className='truncate font-semibold'>{name}</span>
          {email && <span className='text-muted-foreground truncate text-xs'>{email}</span>}
        </div>
      )}
    </div>
  );
}
