# Orbit

A general-purpose AI chatbot with a pixel-art robot, powered by [Groq](https://groq.com).
Plain HTML/CSS/JS front end + one Vercel serverless function (`api/chat.js`). No database, auth or payments.

## Run locally
```
cp .env.example .env     # then put your key in .env (never commit it)
node dev-server.js       # http://localhost:3000   (Node 18+)
```

## Deploy on Vercel
1. Push this folder to a GitHub repo and **Import** it in Vercel (framework preset: *Other*).
2. Project Settings → Environment Variables: add `GROQ_API_KEY` (required) and optionally `GROQ_MODEL` (default `llama-3.3-70b-versatile`).
3. Deploy (or redeploy after adding variables).

## Limits (see top of `api/chat.js`)
2000 chars per message · last 12 messages sent as context · 12,000 chars total · 1024 output tokens · 25 s upstream timeout.

## Tests
`node test/api.test.js` runs the API handler against a stubbed Groq (no key needed).
