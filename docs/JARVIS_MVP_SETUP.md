# NEAS JARVIS MVP — AI endpoint setup and current readiness

## Implemented in the development branch
- `api/jarvis/chat.js`: server-side OpenAI-compatible chat endpoint. It defaults to the Groq-compatible API URL but requires a server-side key.
- `public/jarvis/index.html`: sends text and browser speech-recognition transcripts to the same-origin endpoint; responses can be spoken with browser speech synthesis.
- `public/jarvis/registry.json`: structured agent and skill metadata used by the agent command-center page.
- The chat endpoint selects a specialist agent label from the user's latest message and returns it with the model response. This is lightweight routing, not yet a multi-agent execution engine.

## Required Preview environment variables
Set these in Vercel → Project → Settings → Environment Variables → Preview, scoped to the JARVIS development branch:
- `NEAS_AI_BASE_URL=https://api.groq.com/openai/v1` (or another OpenAI-compatible provider endpoint)
- `NEAS_AI_API_KEY=<provider key>` (server-only; do not use a `NEXT_PUBLIC_` prefix)
- `NEAS_AI_MODEL=<model supported by the chosen provider>`

Never commit actual credentials. Do not paste API keys into source files or browser JavaScript. If using Groq, select a model currently available in the Groq account and set its exact model identifier in `NEAS_AI_MODEL`.

## Security and data limitations
- The endpoint only handles general chat. It does not query Supabase, project records, files, CRM, email, calendar or other company systems.
- It does not execute business actions or write to company data.
- Do not expose an unauthenticated public endpoint with a paid provider key. Before enabling public access, put the Preview deployment behind Vercel Deployment Protection or implement Supabase user authentication, authorization, robust rate limiting and audit logging.
- The current endpoint has same-origin checking and request-size/message-count validation, but these are not substitutes for user authentication or distributed rate limiting.
- Browser speech recognition depends on browser support and microphone permission. Speech synthesis uses an available local browser voice; Taglish quality varies by installed voice.
- Do not use this MVP for safety-critical decisions without competent-person review.

## Deployment blocker found during repository review
The branch has Next.js 14 dependencies and `vercel.json` configured for the Next.js framework, but the repository root currently has no `app/` or `pages/` directory. A standard Next.js build normally requires one. This must be reconciled with the existing static/legacy deployment structure before claiming a successful Vercel Preview deployment. Do not create a replacement root app or change production routing without reviewing the original deployment architecture first.

## MVP acceptance checks
1. Confirm Vercel Preview build succeeds without changing Production.
2. Protect Preview with Vercel Deployment Protection before adding a provider key.
3. Add the three server-side environment variables and redeploy Preview.
4. Open `/jarvis/`, send a text message, and confirm a real model response.
5. Test microphone permission, English/Filipino speech input, stop/mute and browser voice output.
6. Confirm no provider key appears in browser source, network responses or static assets.
7. Test invalid method, oversized payload, provider error and missing-key behavior.
8. Only after acceptance, add authenticated data retrieval and multi-agent skill execution.
