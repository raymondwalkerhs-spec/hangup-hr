import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Button } from "./Button";
import { ErrorBoundary } from "./ErrorBoundary";
import styles from "./Dialog.module.css";

type DialogSize = "default" | "wide" | "xlarge";

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  wide,
  xlarge,
  size,
  scrollBody,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  xlarge?: boolean;
  size?: DialogSize;
  scrollBody?: boolean;
  footer?: React.ReactNode;
}) {
  const resolved = size || (xlarge ? "xlarge" : wide ? "wide" : "default");
  const sizeClass =
    resolved === "xlarge" ? styles.xlarge : resolved === "wide" ? styles.wide : "";
  const reduce = useReducedMotion();
  const enter = reduce ? 0 : 0.25;
  const exit = reduce ? 0 : 0.15;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                className={styles.overlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: exit, ease: "easeOut" }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild>
              <motion.div
                className={`${styles.content} ${sizeClass}`}
                style={{ x: "-50%", y: "-50%" }}
                initial={{ opacity: 0, y: "-48%" }}
                animate={{ opacity: 1, y: "-50%" }}
                exit={{ opacity: 0, y: "-48%", transition: { duration: exit, ease: "easeOut" } }}
                transition={{ duration: enter, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className={styles.header}>
                  <DialogPrimitive.Title className={styles.title}>{title}</DialogPrimitive.Title>
                  <DialogPrimitive.Close asChild>
                    <Button variant="ghost" size="sm" aria-label="Close">
                      <X size={18} />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
                <div className={`${styles.body} ${scrollBody ? styles.bodyScroll : ""}`}>
                  <ErrorBoundary label={title}>
                    {children}
                  </ErrorBoundary>
                </div>
                {footer && <div className={styles.footer}>{footer}</div>}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  onConfirm,
  danger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Confirm
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Dialog>
  );
}
