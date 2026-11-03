# NEAS JARVIS AI Brain — Prototype

## What this branch adds
- A self-contained, responsive holographic JARVIS interface at `/jarvis/`.
- Animated core and orbit rings with idle, listening, thinking, and speaking states.
- Browser-native speech recognition where supported (Chrome/Edge commonly support the Web Speech recognition API).
- Browser-native speech synthesis for spoken demo responses.
- Text input fallback, stop/mute control, and a visible local-demo/privacy status.

## Run and preview
Deploy this branch to a Vercel Preview Deployment, then open `/jarvis/`. For local preview, run the existing project using its documented development command and open `http://localhost:3000/jarvis/`.

## Important current limitations
This is the first interface prototype, not a connected AI assistant yet. It does not call OpenAI, Groq, Supabase, or any external service. Responses are local demonstration responses. Browser speech recognition availability and microphone permission depend on the browser, device, and secure context.

## Next integration phase
1. Add a server-side authenticated AI endpoint; keep provider keys in server environment variables only.
2. Connect the chat UI to the selected model with streaming responses and error handling.
3. Add a configurable voice provider and optional Taglish voice.
4. Add explicit user-approved retrieval from NEAS project records, with Supabase RLS enforced server-side.
5. Add consent, retention controls, rate limits, and audit logs before storing voice transcripts or business data.

Do not expose Supabase service-role keys or model API keys in browser code.
