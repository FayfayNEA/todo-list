// Swaps @vercel/blob for the in-memory fake before any api/ module loads it.
import { registerHooks } from 'node:module';
const fake = new URL('./fakeblob.mjs', import.meta.url).href;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@vercel/blob') return { url: fake, shortCircuit: true };
    return next(spec, ctx);
  },
});
