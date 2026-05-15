import type { CSSProperties, HTMLAttributes } from "react";

type Variant = "block" | "line" | "circle";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  variant?: Variant;
  width?: number | string;
  height?: number | string;
  rounded?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
};

const roundedClass: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
};

function toCss(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" ? `${v}px` : v;
}

export function Skeleton({
  variant = "block",
  width,
  height,
  rounded,
  className = "",
  style,
  ...rest
}: SkeletonProps) {
  const isCircle = variant === "circle";
  const isLine = variant === "line";
  const radius = isCircle ? "rounded-full" : roundedClass[rounded ?? (isLine ? "full" : "md")];
  const composedStyle: CSSProperties = {
    width: toCss(width) ?? (isLine ? "100%" : undefined),
    height: toCss(height) ?? (isLine ? "0.75em" : isCircle ? toCss(width) : undefined),
    ...style,
  };
  return (
    <div
      aria-hidden="true"
      className={`skeleton motion-safe:animate-shimmer ${radius} ${className}`}
      style={composedStyle}
      {...rest}
    />
  );
}

type SkeletonTextProps = {
  lines?: number;
  className?: string;
  lastLineWidth?: string;
};

export function SkeletonText({
  lines = 3,
  className = "",
  lastLineWidth = "60%",
}: SkeletonTextProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="line"
          height={12}
          width={i === lines - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
}
