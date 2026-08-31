import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => (
    <button
      ref={ref}
      data-variant={variant}
      className={clsx(styles.btn, styles[variant], styles[size], className)}
      {...props}
    >
      {children}
    </button>
  )
);
Button.displayName = "Button";
