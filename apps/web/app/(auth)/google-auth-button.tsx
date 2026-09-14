import { Button } from '@/components/controls/button';
import { signInWithGoogleAction } from './oauth-actions';

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#4285F4"
        d="M21.35 12.27c0-.82-.07-1.61-.21-2.36H12v4.47h5.22a4.46 4.46 0 0 1-1.94 2.93v2.44h3.14c1.84-1.69 2.93-4.18 2.93-7.48Z"
      />
      <path
        fill="#34A853"
        d="M12 21.75c2.63 0 4.84-.87 6.45-2.36l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.52A9.75 9.75 0 0 0 12 21.75Z"
      />
      <path
        fill="#FBBC05"
        d="M6.54 13.84A5.85 5.85 0 0 1 6.23 12c0-.64.11-1.27.31-1.84V7.64H3.3A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1.05 4.36l3.24-2.52Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.13c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.83 3.22 14.63 2.25 12 2.25A9.75 9.75 0 0 0 3.3 7.64l3.24 2.52C7.31 7.85 9.46 6.13 12 6.13Z"
      />
    </svg>
  );
}

export function GoogleAuthButton() {
  return (
    <form action={signInWithGoogleAction} className="mt-4">
      <Button type="submit" tone="secondary" className="w-full gap-2">
        <GoogleMark />
        Continue with Google
      </Button>
    </form>
  );
}
