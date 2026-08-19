import { faceForMime } from "@ragbag/shared";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Icon } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import { photoLink, type AppSearch } from "@/lib/routes";
import type { Attachment } from "@/lib/types";

// One picture, as large as the screen will draw it (plan §6.3).
//
// The detail panel used to answer a click on a photo by opening the original
// bytes in a browser tab: you left the app to see your own picture at full
// size, landed on a bare image with no idea which message it came from, and
// came back with the back button. A message with five photos in it could not
// be looked *through* at all.
//
// Two ways in, one viewer: the album at the top of the panel and the
// attachment rows below it (components/message-detail.tsx), which is why this
// is a scope with a map of the message's pictures in it rather than a piece of
// state inside either one. Stepping then covers every picture in the message
// whichever one you opened, including the ones past the album's `+N` cap,
// which nothing else in the app could reach.
//
// Outside a scope `usePhotoViewer` is null, exactly as with the audio scope
// next door: the timeline has no viewer, and a tile there still opens the
// message it belongs to.
//
// The surface is the app's own canvas, in whichever theme the app is in, and
// the chrome on it is the ordinary foreground and muted-foreground. It used to
// force `dark` and paint itself near-black in both themes, which made this the
// one screen in the app that ignored the theme the reader chose: opening a
// picture from a light app was a full-screen jump to black and back. A
// picture that is mostly white now needs an edge to end on, which is what the
// border on it is for. No viewer-only colours are invented here either way.

type PhotoViewer = {
  /** Show this attachment full screen. Ignored for anything but a picture. */
  open: (attachmentId: string) => void;
};

const ViewerContext = createContext<PhotoViewer | null>(null);

/** This surface's viewer, or null outside a scope, which is the timeline. */
export function usePhotoViewer(): PhotoViewer | null {
  return useContext(ViewerContext);
}

export function PhotoViewerScope({
  attachments,
  children,
}: {
  attachments: readonly Attachment[];
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  // Which photo is open is in the URL (lib/routes.ts), so the back gesture
  // closes the photo and leaves the message open underneath it.
  const { photo } = useSearch({ strict: false }) as AppSearch;

  const photos = useMemo(
    () => attachments.filter((a) => faceForMime(a.mime) === "image"),
    [attachments],
  );
  const index = photos.findIndex((a) => a.id === photo);
  const current = index >= 0 ? photos[index]! : null;

  const show = useCallback(
    (id: string | undefined, replace: boolean) => {
      void navigate({ ...photoLink(id), replace });
    },
    [navigate],
  );

  // Whether the entry the viewer is sitting on is one we pushed.
  //
  // Opening pushes, so closing has to *go back* rather than navigate forward,
  // or the entry the viewer was opened from is still ahead in the stack and
  // the back button reopens the photo you just closed. Following a link
  // straight to `?photo=…` pushed nothing, and going back from there would
  // leave the app entirely, so that case replaces instead. Stepping between
  // photos replaces too, which is what keeps five photos from costing five
  // presses to get out of.
  const pushed = useRef(false);

  const open = useCallback(
    (id: string) => {
      pushed.current = true;
      show(id, false);
    },
    [show],
  );

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      router.history.back();
      return;
    }
    show(undefined, true);
  }, [router, show]);

  const step = useCallback(
    (delta: number) => {
      const next = photos[index + delta];
      if (next) show(next.id, true);
    },
    [index, photos, show],
  );

  const viewer = useMemo(() => ({ open }), [open]);

  // An id that names nothing in this message: a link to a photo that has since
  // been deleted, or a hand-edited URL. Drop it rather than sit on a query
  // string that shows nothing, and replace so the bad address leaves no entry.
  useEffect(() => {
    if (photo && photos.length > 0 && index < 0) show(undefined, true);
  }, [photo, photos.length, index, show]);

  // The arrow keys, for as long as something is open. Esc is the dialog's own.
  //
  // On the capture phase, which is not a detail: an open dialog swallows the
  // arrow keys on the way back up (they are how Base UI moves through the
  // things inside a popup), so a listener waiting for them to bubble to the
  // window is never called and the keyboard silently does nothing. Measured
  // here, headless Chromium: the event reaches the window going *down* and
  // never comes back up.
  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current, step]);

  // Both neighbours, fetched while you look at this one. The media URL is
  // stable and the worker caches by it (lib/media.ts), so this is exactly what
  // the next step reads: the difference between arrowing through an album and
  // watching each picture arrive.
  useEffect(() => {
    if (!current) return;
    for (const near of [photos[index - 1], photos[index + 1]]) {
      if (near) new Image().src = mediaUrl(near.blobId, "display");
    }
  }, [current, index, photos]);

  return (
    <ViewerContext.Provider value={viewer}>
      {children}
      <Dialog open={current !== null} onOpenChange={(next) => !next && close()}>
        <DialogPortal>
          {/* The scrim is the popup's own fill rather than a `Dialog.Backdrop`,
              and that is not a preference: this dialog opens from inside the
              detail drawer, and Base UI renders no backdrop at all for a
              nested one (measured: no `dialog-overlay` in the DOM, the photo
              floating over a fully lit app with the caption illegible against
              the panel behind it). The popup is `inset-0` regardless, so it is
              the same rectangle the backdrop would have been.

              Opaque, where the app's ordinary scrim is tuned to let a screen
              show through behind a small dialog. This is not a dialog in front
              of the app, it is the picture and nothing else, and a picture is
              judged against what surrounds it. At 90% the panel behind stayed
              legible enough to read, which put a second close button a few
              pixels from this one's. The canvas colour, not a wash over it, so
              nothing of the panel behind shows through at any theme.

              Paying for the fill by hand means paying for the click by hand
              too: pressing the scrim is outside the *picture* but inside the
              popup, so Base UI's own dismissal never sees it. Anything that is
              not a control and not the picture closes. */}
          <DialogPopup
            className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (!target.closest("button, a, img")) close();
            }}
          >
            {current && (
              <>
                <DialogTitle className="sr-only">{current.filename}</DialogTitle>
                <DialogDescription className="sr-only">
                  {photos.length > 1
                    ? `Picture ${index + 1} of ${photos.length} in this message.`
                    : "The picture in this message, full screen."}
                </DialogDescription>

                <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                  {photos.length > 1 && (
                    // Padded to the same corner as everything else in this row.
                    // Bare text sits where its box does; a button's ink sits
                    // its own padding further in, so 12px of row padding puts
                    // the close glyph 20px off the right edge and 20px down,
                    // and put this counter 13px off the left edge and 21px
                    // down: square at one corner of the screen and not at the
                    // other. The 8px is that button padding, spelled here
                    // because this child has none of its own.
                    <span className="pl-2 font-mono text-[11px] text-muted-foreground">
                      {index + 1} of {photos.length}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    {/* The bytes exactly as they were sent, which is what the
                        tile used to open. Still worth an explicit way to: the
                        picture above is the web-safe transcode, and a phone
                        photo's original is the one with its metadata in it. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      render={
                        <a
                          href={mediaUrl(current.blobId, "original")}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      <Icon name="external" className="size-3.5" /> Original
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Close (Esc)"
                      className="text-muted-foreground"
                      onClick={close}
                    >
                      <Icon name="x" className="size-4" />
                    </Button>
                  </span>
                </div>

                <div className="relative flex min-h-0 flex-1 items-center justify-center px-3">
                  {/* Keyed, so stepping is a fresh picture rather than the
                      previous one's source ladder carried over: a photo that
                      had run out of sources would otherwise hand its blurred
                      stand-in to the next one. */}
                  <MediaImage
                    key={current.id}
                    blobId={current.blobId}
                    variant="display"
                    placeholder={current.placeholder}
                    alt={current.generatedTitle ?? current.filename}
                    fit="contain"
                    sizing="fit"
                    // Barely rounded, and edged. On a canvas the same colour as
                    // the page, a photo of a white wall would otherwise have no
                    // end: the border is what says where the picture stops.
                    // Corners stay near-square because this is the picture at
                    // full size rather than a tile in a layout, and 12px of
                    // radius eats a visible bite out of it at that scale.
                    className="rounded border"
                  />
                  {photos.length > 1 && (
                    <>
                      <Step side="left" onStep={() => step(-1)} disabled={index === 0} />
                      <Step
                        side="right"
                        onStep={() => step(1)}
                        disabled={index === photos.length - 1}
                      />
                    </>
                  )}
                </div>

                {/* The same line the file row draws under a name, for the same
                    reason: the size is a reading and takes the mono, the
                    filename beside it is a name and keeps the document's. */}
                <div className="shrink-0 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center">
                  <p className="truncate text-sm font-medium">
                    {current.generatedTitle ?? current.filename}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{formatBytes(current.size)}</span>
                    {current.generatedTitle && current.generatedTitle !== current.filename
                      ? ` · ${current.filename}`
                      : ""}
                  </p>
                </div>
              </>
            )}
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </ViewerContext.Provider>
  );
}

/** One of the two edge controls. A disc, because it sits on a picture. */
function Step({
  side,
  onStep,
  disabled,
}: {
  side: "left" | "right";
  onStep: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      title={side === "left" ? "Previous (←)" : "Next (→)"}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-card/70 hover:bg-card ${
        side === "left" ? "left-2" : "right-2"
      }`}
      onClick={onStep}
    >
      <Icon name={side} className="size-5" />
    </Button>
  );
}
