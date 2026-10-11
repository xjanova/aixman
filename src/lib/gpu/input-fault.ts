/**
 * Whether a render failed on what the customer sent rather than on the machine.
 *
 * LatentSync stops with "Face not detected" when some frame of the clip has no
 * face it can find, and the clip loader the latentsync-1.6 setup script writes
 * (catalog.ts) marks its own refusals `AIXMAN_INPUT:`. Another machine would
 * fail the same way, so GpuQueue neither retries such a job nor counts it
 * against the model, and tells the customer what to change.
 */
export function isCustomerInputFault(message: string): boolean {
  return /Face not detected|AIXMAN_INPUT:/i.test(message);
}
