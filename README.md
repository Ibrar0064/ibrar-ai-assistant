# Ibrar AI Assistant

A simple Node.js + Express web AI assistant.

## Deployment

This repository is prepared for deployment as a Render Web Service.

### Required environment variables

- `OPENAI_API_KEY` — your OpenAI API key. Keep this secret and add it only in the hosting provider's environment-variable settings.
- `OPENAI_MODEL` — defaults to `gpt-5.6-luna`.
- `PORT` — supplied automatically by Render.

### Local/server requirements

- Node.js 18 or newer
- Start command: `npm start`

The server listens on `0.0.0.0` and uses the platform-provided `PORT`, which is required for public cloud hosting.

## Health check

After deployment, open:

`/api/health`

It should return JSON showing that the application is running.

## Security

Never commit a real `OPENAI_API_KEY` to GitHub. The repository ignores `.env` files; configure the secret in the hosting provider instead.
