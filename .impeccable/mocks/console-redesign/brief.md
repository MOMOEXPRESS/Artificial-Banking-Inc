# Console redesign exploration

User request: replace the console visual world, prioritizing marketplace shopping and seller inventory. Improve spacing, colors and interactions. Homepage remains under its existing design authority; existing backend, wallet, x402 and settlement behavior is preserved. Mode: Operate. Build path: comp-first.

Three unapproved studies: 01-marketplace-workbench.png (discovery plus persistent purchase summary, warm neutrals and evergreen), 02-assisted-shopping.png (brief/progress column plus side-by-side comparison, cool neutrals and cobalt), 03-commerce-operations.png (inventory table plus contextual editor, graphite and clay). Each includes fictional demo content and is a direction study, not evidence of live product capabilities.

Recommended synthesis for user consideration: option 1's shopping composition and restrained palette with option 3's inventory table/editor interaction. The user has not selected or approved this synthesis. No implementation direction is locked.

Implementation coverage after selection: shared shell, buyer overview, shopping/search/product/shortlist/quote/orders/cases, seller onboarding/inventory/listing editor/fulfillment, Assistant, agents, wallet/transactions/ledger, approvals/policies, developer tools, account settings, and mobile navigation. Retain permission checks, truthful empty/error/loading states, keyboard access and separation between demo and live data.

Launcher and build-phase commands were attempted but unavailable. Concepts are manually presented inline; no random seed or automatic detector result is claimed. Generated sidecars carry exact prompts and approved:false. Await explicit user selection before code or durable design-system replacement.

## Approved direction
User selected exactly option 2 with the blue palette and confirmed implementation. Approved reference: 02-assisted-shopping.webp. Implement the narrow navy rail, horizontal workspace navigation, shopping brief/progress column and comparison workspace. Seller inventory, order review and ancillary console views use the same spacing, controls and token system. Existing payment and API behavior remains authoritative.

Latest scope extension: user requested homepage/public pages match the console white/blue look. public-studio.css now applies that palette and control treatment to .landing, preserving section structure and content. This explicitly supersedes the earlier preserve-public-colors boundary. Reviewed console additions include a photographic guide product image, semantic comparison table, sticky review bar and synchronized seller panel navigation.
