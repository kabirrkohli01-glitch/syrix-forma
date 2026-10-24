'use client';

import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { submitAccessCode } from '@/features/auth/access-code-actions';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** "about 4 minutes" reads better than a countdown that has to be kept accurate on the client. */
function describeWait(seconds: number): string {
  if (seconds <= 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

export function AccessCodeForm({
  codeLength,
  initialLockSeconds
}: {
  codeLength: number;
  initialLockSeconds: number;
}) {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(
    initialLockSeconds > 0
      ? `Too many incorrect codes. Try again in ${describeWait(initialLockSeconds)}.`
      : null
  );
  const [locked, setLocked] = React.useState(initialLockSeconds > 0);
  const [pending, startTransition] = React.useTransition();

  // The submit is fired from the change handler rather than from a button, because a code this
  // short is finished the moment the last digit lands and asking for a second gesture to confirm
  // it is friction with nothing behind it. The button below stays for keyboard and paste.
  function attempt(value: string) {
    if (value.length !== codeLength || pending || locked) return;

    startTransition(async () => {
      const result = await submitAccessCode(value);

      if (result.status === 'ok') {
        // replace() rather than push(): the code screen should not be somewhere the back button
        // returns to once it has been answered.
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      setCode('');

      if (result.status === 'locked') {
        setLocked(true);
        setMessage(`Too many incorrect codes. Try again in ${describeWait(result.retryAfterSeconds)}.`);
        return;
      }

      if (result.status === 'unavailable') {
        setMessage('This deployment is not configured to accept a code.');
        return;
      }

      // How many attempts are left is deliberately not reported: it tells anybody guessing
      // exactly how much budget they have before the cost rises.
      setMessage('That code is not right.');
    });
  }

  function handleChange(value: string) {
    setCode(value);
    if (message && !locked) setMessage(null);
    attempt(value);
  }

  return (
    <form
      className='flex w-full flex-col items-center gap-5'
      onSubmit={(event) => {
        event.preventDefault();
        attempt(code);
      }}
    >
      <InputOTP
        maxLength={codeLength}
        value={code}
        onChange={handleChange}
        disabled={locked || pending}
        autoFocus
        aria-label='Access code'
      >
        <InputOTPGroup>
          {Array.from({ length: codeLength }, (_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>

      {message && (
        <p
          role='status'
          aria-live='polite'
          className='text-destructive text-center text-sm'
        >
          {message}
        </p>
      )}

      <Button type='submit' className='w-full' disabled={code.length !== codeLength || pending || locked}>
        {pending ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  );
}
