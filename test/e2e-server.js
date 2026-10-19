// Test-only: runs the real dev server but stubs the outbound Groq call.
process.env.GROQ_API_KEY = 'fake-test-key';
process.env.PORT = process.env.PORT || '3111';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  const last = body.messages.at(-1).content;
  await new Promise((r) => setTimeout(r, 700));
  if (/fail/i.test(last)) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
  const reply = `You said: **${last.slice(0, 40)}**\n\n- context messages: ${body.messages.length - 1}\n- model: ${body.model}\n\n\`\`\`js\nconsole.log("hi <b>not html</b>");\n\`\`\``;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: reply } }] }) };
};
await import('../dev-server.js');
