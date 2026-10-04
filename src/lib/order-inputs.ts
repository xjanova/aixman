/**
 * The files an order was made from, as the studio may put them back.
 *
 * Opening a past piece in the studio reloads the whole order — prompt,
 * settings *and* the uploads it was made from — so the customer can change one
 * thing and order again. The uploads live in two places on the row: the old
 * `inputImage` column (usually a base64 data URL, sometimes one of our own
 * object URLs) and `params` (`inputAudio`, `inputVideo`, `inputImageEnd`; see
 * generation.ts and RetentionService's INPUT_URL_PARAMS).
 *
 * Only what /api/generate would accept back is returned: the three URL fields
 * must be uploads of ours (it refuses anything else with 400), and the image
 * must be an image data URL or one of ours. Anything else on the row — an old
 * provider URL, a value a client made up — is dropped rather than handed to a
 * page that would show it and then send it.
 */
export interface OrderInputs {
  inputImage: string | null;
  inputImageEnd: string | null;
  inputAudio: string | null;
  inputVideo: string | null;
}

const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i;

export const NO_ORDER_INPUTS: OrderInputs = {
  inputImage: null,
  inputImageEnd: null,
  inputAudio: null,
  inputVideo: null,
};

export function orderInputs(
  row: { inputImage: string | null; params: unknown },
  isOurUpload: (url: string) => boolean
): OrderInputs {
  const params =
    row.params && typeof row.params === 'object' && !Array.isArray(row.params)
      ? (row.params as Record<string, unknown>)
      : {};
  const upload = (value: unknown): string | null =>
    typeof value === 'string' && value !== '' && isOurUpload(value) ? value : null;
  const image = row.inputImage;

  return {
    inputImage: image && (IMAGE_DATA_URL.test(image) || isOurUpload(image)) ? image : null,
    inputImageEnd: upload(params.inputImageEnd),
    inputAudio: upload(params.inputAudio),
    inputVideo: upload(params.inputVideo),
  };
}
