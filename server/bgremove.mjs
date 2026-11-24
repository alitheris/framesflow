// Background removal → transparent PNG, fully local (no API, no upload).
// Model: BiRefNet-lite (MIT) through transformers.js (Apache-2.0). Deliberately NOT @imgly/background-removal
// (AGPL) and NOT RMBG-1.4 (non-commercial licence), so the studio can be hosted commercially.
// The model (~45 MB) downloads once from the Hugging Face hub and is cached on disk.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './lib.mjs';

export const BG_MODEL = 'onnx-community/BiRefNet_lite-ONNX';
let loading = null;

async function load() {
  if (!loading) {
    loading = (async () => {
      const tf = await import('@huggingface/transformers');
      tf.env.cacheDir = path.join(HOME, 'models');
      // BiRefNet has a fixed 1024 px input; turning the CPU memory arena off keeps peak RAM lower
      const model = await tf.AutoModel.from_pretrained(BG_MODEL, { dtype: 'fp32', session_options: { enableCpuMemArena: false, enableMemPattern: false } });
      const processor = await tf.AutoProcessor.from_pretrained(BG_MODEL);
      return { tf, model, processor };
    })().catch(e => { loading = null; throw e; });
  }
  return loading;
}

/** Cut the subject out of an image file. Writes a PNG with an alpha channel to outFile. */
export async function removeBackground(inFile, outFile) {
  if (!fs.existsSync(inFile)) throw new Error('Image not found: ' + inFile);
  const { tf, model, processor } = await load();
  const { RawImage } = tf;
  const image = await RawImage.read(inFile);
  const { pixel_values } = await processor(image);
  const out = await model({ input_image: pixel_values });
  const tensor = out.output_image ?? Object.values(out)[0];
  const mask = await RawImage.fromTensor(tensor[0].sigmoid().mul(255).to('uint8')).resize(image.width, image.height);
  const rgba = image.rgba();
  rgba.putAlpha(mask);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await rgba.save(outFile);
  return { width: image.width, height: image.height };
}
