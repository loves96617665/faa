/**
 * Node 18+ example: create is done in UI; this only calls /v1
 *
 *   FAA_KEY=faa_sk_... node docs/examples/generate.mjs "a cute cat"
 */
const BASE = process.env.BASE || "https://faa.kinai.workers.dev";
const KEY = process.env.FAA_KEY;
if (!KEY) {
  console.error("Set FAA_KEY=faa_sk_...");
  process.exit(1);
}

const prompt = process.argv.slice(2).join(" ") || "a cute orange cat, soft light";

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error) data.error = { message: `HTTP ${res.status}` };
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const submit = await api("/v1/generate", {
  method: "POST",
  body: JSON.stringify({
    prompt,
    model: "nano-banana-2-lite",
    aspect: "1:1",
    resolution: "1K",
  }),
});
console.log("submit", submit);
if (!submit.ok) process.exit(1);

const jobId = submit.jobId || submit.chatId;
for (let i = 0; i < 40; i++) {
  const job = await api(`/v1/jobs/${jobId}`);
  console.log(`poll#${i + 1}`, job.status, job.mediaUrl || job.error || "");
  if (job.status === "completed" || job.status === "error") {
    console.log(JSON.stringify(job, null, 2));
    process.exit(job.status === "completed" ? 0 : 2);
  }
  await sleep(3000);
}
console.error("timeout");
process.exit(3);
