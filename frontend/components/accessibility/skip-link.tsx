'use client';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-trust focus:text-trust-foreground focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-trust focus:ring-offset-2"
    >
      Skip to main content
    </a>
  );
}
