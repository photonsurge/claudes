/**
 * Proof that grib/bakePool actually runs bakes in a worker thread — the thing
 * Jest can't show (its runtime won't host the ts-node/node worker the live app
 * uses, so under Jest the pool falls back to inline and worker==0).
 *
 * Runs every scalar + vector bake through the pool, asserts worker>0, inline==0,
 * and the output is byte-identical to the inline bake. Run it in BOTH runtimes:
 *   dev:  yarn prove:bakepool           (ts-node → dist-free .ts worker)
 *   prod: yarn build && node dist/scripts/proveBakePool.js   (.js worker)
 * Exits non-zero on any fallback or mismatch.
 */
import { bakeScalar, bakeVector, bakePoolStats, shutdownBakePool } from "../grib/bakePool";
import { bakeScalar as inlineScalar } from "../grib/bakeScalar";
import { bakeVector as inlineVector } from "../grib/bakeVector";
(async () => {
  const W = 64, H = 32;
  const g = (s: number) => { const a = new Float32Array(W*H); for (let i=0;i<a.length;i++) a[i]=280+((i*s)%40); return a; };
  const ids = ["temp","humidity","pressure","gust","temp","humidity","pressure","gust"];
  const pooled = await Promise.all(ids.map((v,i)=>bakeScalar({variableId:v,values:g(i+1),width:W,height:H,preRolled:true})));
  const inline = await Promise.all(ids.map((v,i)=>inlineScalar({variableId:v,values:g(i+1),width:W,height:H,preRolled:true})));
  const vPool = await bakeVector({variableId:"wind",u:g(3),v:g(5),width:W,height:H,preRolled:true});
  const vInline = await inlineVector({variableId:"wind",u:g(3),v:g(5),width:W,height:H,preRolled:true});
  let identical = 0;
  for (let i=0;i<ids.length;i++) if (Buffer.compare(pooled[i].buffer, inline[i].buffer)===0) identical++;
  const vecOk = Buffer.compare(vPool.buffer, vInline.buffer)===0;
  // Crossing the thread boundary must NOT downgrade the Buffer to a plain
  // Uint8Array — Mongoose's SchemaBuffer.cast rejects that at texture-write time.
  const allBuffers = [...pooled, vPool].every((r) => Buffer.isBuffer(r.buffer));
  const st = bakePoolStats();
  console.log("STATS:", JSON.stringify(st));
  console.log(`scalar identical: ${identical}/${ids.length}   vector identical: ${vecOk}   all Buffers: ${allBuffers}`);
  const pass = st.worker >= ids.length + 1 && st.inline === 0 && identical === ids.length && vecOk && allBuffers;
  console.log(pass ? "PROOF PASS: worker thread served ALL bakes, output byte-identical to inline" : "PROOF FAIL");
  await shutdownBakePool();
  process.exit(pass ? 0 : 1);
})();
