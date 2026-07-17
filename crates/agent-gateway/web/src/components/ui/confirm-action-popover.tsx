import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import { AlertTriangle } from "../icons";
import { Button } from "./button";

// Exit animation length; must stay >= the confirmPopoverOut duration in
// styles.css so the popup is not unmounted mid-animation.
const CONFIRM_POPOVER_CLOSE_MS = 130;

export function ConfirmActionPopover(props: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  // Popover edge to align with the trigger; "end" suits right-aligned action
  // rows (settings lists), "start" left-aligned ones (assistant reply row).
  align?: "start" | "end";
  // Preferred trigger side to open from; flips when that side lacks room.
  side?: "top" | "bottom";
  children: (open: () => void) => ReactNode;
}) {
  const {
    title,
    description,
    confirmLabel,
    onConfirm,
    align = "end",
    side = "bottom",
    children,
  } = props;
  const { t } = useLocale();
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);
  const [placeUp, setPlaceUp] = useState(side === "top");
  const ref = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  function requestClose() {
    if (!show || closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setClosing(false);
      setShow(false);
    }, CONFIRM_POPOVER_CLOSE_MS);
  }

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!show) return;

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) requestCloseRef.current();
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [show]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  function handleOpen() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    if (ref.current) {
      // Popover is ~160px tall; keep the preferred side unless it lacks room
      // and the opposite side has more.
      const rect = ref.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const preferUp = side === "top";
      const preferredSpace = preferUp ? spaceAbove : spaceBelow;
      const oppositeSpace = preferUp ? spaceBelow : spaceAbove;
      setPlaceUp(preferredSpace >= 170 || preferredSpace >= oppositeSpace ? preferUp : !preferUp);
    } else {
      setPlaceUp(side === "top");
    }
    setShow(true);
  }

  return (
    <div className="relative" ref={ref}>
      {children(handleOpen)}
      {show ? (
        <div
          data-place={placeUp ? "up" : "down"}
          data-align={align}
          data-closing={closing ? "" : undefined}
          className={`settings-confirm-popover absolute z-50 w-64 ${
            align === "start" ? "left-0" : "right-0"
          } ${placeUp ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
        >
          <div className="rounded-xl border border-border bg-popover p-3 shadow-lg">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{title}</p>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={requestClose}
              >
                {t("settings.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  requestClose();
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ConfirmDeletePopover(props: {
  name: string;
  onConfirm: () => void;
  children: (open: () => void) => ReactNode;
}) {
  const { t } = useLocale();

  return (
    <ConfirmActionPopover
      title={t("settings.deleteConfirm")}
      description={
        <>
          {t("settings.deleteConfirmYes")}{" "}
          <span className="font-medium text-foreground">{props.name}</span>？
          {t("settings.deleteConfirmDesc")}
        </>
      }
      confirmLabel={t("settings.delete")}
      onConfirm={props.onConfirm}
    >
      {props.children}
    </ConfirmActionPopover>
  );
}
