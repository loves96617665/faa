/**
 * OpenAI Images-compatible example against FAA Worker.
 *
 *   FAA_KEY=faa_sk_... node docs/examples/openai-images.mjs "a cute cat"
 *
 * Or with official openai package:
 *   OPENAI_API_KEY=faa_sk_... node -e "
 *     import OpenAI from 'openai';
 *     const c=new OpenAI({apiKey:process.env.OPENAI_API_KEY, baseURL:'https://faa.kinai.workers.dev/v1'});
 *     const r=await c.images.generate({model:'nano-banana-2-lite', prompt:'a cat', size:'1024x1024'});
 *     console.log(r.data[0].url);
 *   "
 */
const BASE = process.env.BASE || "https://faa.kinai.workers.dev";
const KEY = process.env.FAA_KEY || process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("Set FAA_KEY=faa_sk_... (or OPENAI_API_KEY)");
  process.exit(1);
}

const prompt = process.argv.slice(2).join(" ") || "a cute orange cat, soft daylight";

const res = await fetch(`${BASE}/v1/images/generations`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt,
    model: "nano-banana-2-lite",
    n: 1,
    size: "1024x1024",
    response_format: "url",
    timeout: 90,
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (!res.ok || data.error) process.exit(1);
if (data.data?.[0]?.url) {
  console.log("\nURL:", data.data[0].url);
}
