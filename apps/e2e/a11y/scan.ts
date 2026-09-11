import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * PRD §4.3 S10: "WCAG 2.1 AA on buyer-facing pages; automated axe pass."
 *
 * Scanned inside the journeys rather than in a suite of its own. The pages are
 * already open, already signed in, and already carrying real data - a cart with
 * three sellers in it, an order part-way through fulfilment - which is the
 * state a separate a11y suite would have to rebuild before it could look at
 * anything. The scan costs one call.
 *
 * SERIOUS AND CRITICAL ONLY. A `moderate` finding should not block a ledger
 * fix, and a gate that fires on everything is one people learn to skip. Lower
 * severities are printed, so they are visible without being enforced - the
 * difference between a report and a gate.
 */
export async function expectNoSeriousA11yViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  const advisory = results.violations.filter((violation) => !blocking.includes(violation));

  if (advisory.length > 0) {
    // The advisory half is a REPORT, and a report nobody can read is not one.
    // Playwright's list reporter prints this beside the test it belongs to.
    console.log(
      `[a11y:${label}] ${String(advisory.length)} advisory finding(s): ` +
        advisory.map((v) => `${v.id} (${String(v.impact)})`).join(', '),
    );
  }

  /**
   * The failure message names the RULE, THE ELEMENT and the measurement.
   *
   * "expected 1 to be 0" about accessibility sends the reader to the trace
   * viewer to work out what broke, and the trace does not say which rule - so
   * the one number a contrast failure turns on (4.31 against a required 4.5)
   * would be nowhere on screen. axe already computes it; this prints it, and
   * that is the difference between a gate someone fixes and a gate someone
   * disables.
   */
  expect(
    blocking.flatMap((violation) =>
      violation.nodes.map((node) =>
        [
          `${violation.id} on ${node.target.join(' ')}`,
          indent(node.failureSummary ?? violation.help),
          indent(violation.helpUrl),
        ].join('\n'),
      ),
    ),
    `serious or critical a11y violations on ${label}`,
  ).toEqual([]);
}

/** Axe's summaries are multi-line; indenting them keeps one finding readable
 *  as one block when several are printed together. */
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
