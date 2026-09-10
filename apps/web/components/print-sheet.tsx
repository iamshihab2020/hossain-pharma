import type { ReactNode } from 'react';

/**
 * The shell every printed document sits in.
 *
 * No PDF library. Ctrl+P is the export, and the page is laid out so that what
 * comes out is a document rather than a screenshot of a website: the site
 * chrome is hidden, the ground goes white, and the type sets black so a colour
 * that meant something on screen does not print as an indeterminate grey.
 *
 * A shipping LABEL is deliberately absent. A barcode with no carrier
 * integration behind it scans as nothing, and Phase 6 is where a carrier
 * arrives.
 */
export function PrintSheet({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <style>{`
        @media print {
          @page { margin: 14mm; }
          /* The layout's header and footer are chrome, not content. */
          body > header, body > footer, [data-print="hide"] { display: none !important; }
          body { background: #fff !important; }
          .print-sheet { color: #000; max-width: none; padding: 0; }
          .print-sheet a { text-decoration: none; color: inherit; }
        }
      `}</style>

      <div className="print-sheet mx-auto max-w-3xl px-4 py-8">
        <div data-print="hide" className="mb-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Print this page to save it as a PDF.
          </p>
        </div>

        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </>
  );
}
