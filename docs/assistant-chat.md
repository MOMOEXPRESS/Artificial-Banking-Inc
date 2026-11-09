# ABI Assistant

The console's Ask ABI button opens a keyboard-accessible conversation panel without changing pages. The expand control opens the full conversation. Escape closes the panel and restores focus to its trigger. Desktop and mobile use the same authenticated backend. No microphone or background listening is installed.

## What works

- Existing durable organization-scoped conversation and explicit remember/recall/forget tools.
- Live marketplace search, product detail and comparison, account facts and spending explanations.
- Pending approval cards use the existing authenticated approval route. Typed chat cannot approve payments or borrow owner payment authority. Shopping leads to governed marketplace checkout.
- Enter sends; Shift+Enter inserts a line; composition input is respected. Failed sends retain the draft and attachments. History polling pauses while hidden and does not interrupt a send or force the user away from older messages.
- Organization changes remount both chat surfaces, discard draft credentials/attachments and load the new scope. No conversation or model key is stored in browser local storage.

The new account/workspace model is separately proposed in `account-workspace-plan-2026-11-09.md`. This release does not migrate financial tenancy; “workspace” chat scope currently follows the selected authenticated organization.

## Models and privacy

The local deterministic assistant remains available without a model. It is labeled **limited mode**; it is not presented as a connected reasoning model.

Assistant settings expose the existing owner-only per-organization model consent API. An owner can enable a configured platform model, connect their own OpenAI key, or keep data local. Credentials are encrypted by the existing server key-encryption service and never returned. No provider has been enabled for a real user by this change. A configured model and explicit owner consent are needed for model reasoning and attachment analysis.

The disclosure includes chat, notes, attachments and relevant account/financial context. Existing custom-compatible model configurations continue to work; the simple new-key control uses the OpenAI endpoint. Images require multimodal support in the selected model. Provider errors produce an explicit analysis-failed reply, never a fabricated image description.

## Attachments

Up to three images or UTF-8 text documents per message. Browser raster input: PNG/JPEG/WebP up to 5 MB, resized to at most 768px and re-encoded before sending. Text: TXT/MD/CSV/JSON up to 20 KB. PDF, Office, HTML, SVG, executable files and arbitrary remote URLs are not accepted.

The API applies strict schemas, bounded total size, media signature and canonical base64 checks before accepting attachments. It never fetches uploaded URLs or runs parsers for active documents. Files remain untrusted reference data in the model's user channel; they cannot extend system instructions or add payment tools. Text content is saved in the existing conversation; image bytes are used for the current model request and not persisted. Stored image names do not imply the image is available in a later turn. Model egress must already be enabled before any attachment is admitted. Chat is capped at 15 messages per organization per minute in addition to general API limits.

Verification uses synthetic browser fixtures and a stubbed model transport. It establishes request plumbing and UI behavior, not quality of a live model's reasoning or completed purchases.
