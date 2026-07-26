'use client';

import { useActionState } from 'react';

import { uploadImageAction, type MediaFormState } from './actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/media/validation';

const INITIAL_STATE: MediaFormState = { error: null, notice: null };

export function UploadForm() {
  const [state, formAction, isPending] = useActionState(uploadImageAction, INITIAL_STATE);

  return (
    <form action={formAction} className="grid max-w-xl gap-4" data-testid="media-upload-form">
      <div>
        <Label htmlFor="media-file">Image file</Label>
        {/* The accept list is a convenience for the file picker; the server checks
            the bytes themselves, which is the check that actually holds. */}
        <Input
          id="media-file"
          name="file"
          type="file"
          accept={Object.keys(ALLOWED_IMAGE_TYPES).join(',')}
          required
        />
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          JPEG, PNG or WebP, up to {MAX_UPLOAD_BYTES / (1024 * 1024)} MB. No SVG: it can carry script.
        </p>
      </div>

      <div>
        <Label htmlFor="media-alt">Describe the image</Label>
        <Input
          id="media-alt"
          name="altText"
          placeholder="A keepsake box of hamantaschen and grape juice"
          required
        />
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]" data-testid="upload-error">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--color-success)]" data-testid="upload-notice">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
