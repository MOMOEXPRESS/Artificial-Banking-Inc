import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from "cursor/canvas";

export default function ArtificialBankingIncPlan() {
  return (
    <Stack gap={28} style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <Stack gap={8}>
        <Row gap={8} align="center" wrap>
          <Pill tone="warning">Critical stress-test</Pill>
          <Pill tone="info">ABI proposal</Pill>
          <Pill tone="neutral">Jul 2026</Pill>
        </Row>
        <H1>Artificial Banking Inc — Will It Work?</H1>
        <Text tone="secondary">
          Honest verdict on: entity + token + AI agent “bank accounts” +
          crypto-backed treasury + foundation later + licenses after product is
          real. Legal risks noted, not used as a veto.
        </Text>
      </Stack>

      <Callout tone="warning" title="Blunt verdict first">
        The core intent can work. The default packaging — “create a bank token,
        agents open accounts, crypto backs it” — usually fails. High failure
        probability as stated; viable if pivoted to: ship a policy-gated agent
        treasury OS first (USDC), prove real agent GMV, then introduce a utility
        token with forced demand (fees/bonds/insurance), and only then wear
        “banking” language after partners/licenses. Token-first “AI Bank Inc” is
        the death path most competitors already littered.
      </Callout>

      <Grid columns={4} gap={12}>
        <Stat value="Pivot" label="Required to survive" tone="warning" />
        <Stat value="USDC" label="Real money first" />
        <Stat value="Token #2" label="Not day-one foundation" tone="warning" />
        <Stat value="Bank" label="Brand later, not MVP" tone="danger" />
      </Grid>

      <Stack gap={10}>
        <H2>What you proposed (decoded)</H2>
        <Table
          headers={["Your piece", "What it really is", "Works?"]}
          rows={[
            [
              "Artificial Banking Inc",
              "Operating company / brand for agent finance",
              "Yes — as a company, not a bank",
            ],
            [
              "Agent bank accounts",
              "Policy-gated ledgers / smart accounts for agents",
              "Yes — this is the real product",
            ],
            [
              "ABI token",
              "Speculative claim on future network value",
              "Only if utility ships first",
            ],
            [
              "“Backed by crypto”",
              "Vague unless = transparent treasury + USDC reserves + published attestations",
              "Meaningless until defined",
            ],
            [
              "Foundation later",
              "Governance / grants / token stewardship",
              "Yes — after Inc proves product",
            ],
            [
              "Legal permissions later",
              "Common crypto sequencing; raises heat over time",
              "Possible — costly & reputational",
            ],
          ]}
          rowTone={[
            "success",
            "success",
            "warning",
            "danger",
            "info",
            "warning",
          ]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>What actually works vs what is wishful</H2>
        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader>Works (keep)</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">
                  Agents need treasuries, budgets, escrow, pay-for-API loops
                </Text>
                <Text size="small">
                  Human guardians + kill switches = real demand
                </Text>
                <Text size="small">
                  An Inc that operates software + rails is a normal company
                </Text>
                <Text size="small">
                  Crypto rails (Base, USDC, x402) are production-ready
                </Text>
                <Text size="small">
                  A foundation can fund ecosystem once fees exist
                </Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>Wishful (kill or rewrite)</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">
                  Token launch creates a bank (it doesn’t)
                </Text>
                <Text size="small">
                  “Backed by crypto world” without reserve policy
                </Text>
                <Text size="small">
                  Agents as legal depositors / bank customers
                </Text>
                <Text size="small">
                  Token price = platform health (often inverse)
                </Text>
                <Text size="small">
                  Competing with Coinbase/Catena by memeing “bank”
                </Text>
                <Text size="small">
                  Raising on vision alone after ElizaOS litigation optics
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Stack gap={10}>
        <H2>Why token-first “AI Bank” usually dies</H2>
        <Table
          headers={["Failure mode", "Why it happens"]}
          rows={[
            [
              "Circular value",
              "Token demand depends on platform; platform marketing depends on token pump — no independent cashflow",
            ],
            [
              "Securities optics",
              "Team + roadmap + profit expectation + marketed “bank” = investor lawsuit magnet",
            ],
            [
              "Utility vapor",
              "“Governance” and “backed” with no spend sinks = memecoin with a pitch deck",
            ],
            [
              "Wash GMV",
              "x402 / agent volume is easy to fake; serious capital discounts it",
            ],
            [
              "Brand collision",
              "Calling it a bank invites regulators AND scares builders who want tools not theater",
            ],
            [
              "Competition",
              "Virtuals owns agent-token narrative; Coinbase owns wallets; Catena owns regulated story",
            ],
            [
              "Autonomy fraud risk",
              "Overclaiming agent independence → class-action pattern (ElizaOS-style)",
            ],
          ]}
          striped
        />
        <Text weight="semibold">
          Honest read: your idea is closest to a strong product when the token is
          subordinate. It is closest to a scam when the token is the product.
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>Strongest reframes (same intent, survivable form)</H2>
        <Table
          headers={["Version", "Pitch", "Token role", "Priority"]}
          rows={[
            [
              "A — PolicyVault OS",
              "Fund agent swarms safely; sleep at night",
              "None at MVP; optional later for bonds/fees",
              "Best",
            ],
            [
              "B — Agent Clearinghouse",
              "Escrow + settle A2A jobs; take rate in USDC",
              "ABI as fee/bond/insurance share after GMV",
              "Strong",
            ],
            [
              "C — ABI Network Token",
              "Full Artificial Banking Inc + token day one",
              "Speculative primary",
              "Weakest",
            ],
          ]}
          rowTone={["success", "info", "danger"]}
          striped
        />
        <Callout tone="info" title="Recommendation">
          Run Version A publicly. Keep “Artificial Banking Inc” as the legal
          company name if you love it — but product brand should be treasury /
          clearing / policy, not FDIC cosplay. Introduce Version B token only
          after measurable USDC economic activity.
        </Callout>
      </Stack>

      <Stack gap={10}>
        <H2>When an ABI token CAN work (concrete utilities)</H2>
        <Text>
          A token is not worthless by default. It is worthless if it doesn’t
          force demand. Defensible utilities after product exists:
        </Text>
        <Table
          headers={["Utility", "Mechanism", "Why it’s real"]}
          rows={[
            [
              "Agent bond stake",
              "Sellers/agents lock ABI to access marketplace tiers",
              "Slashable; creates demand + skin in game",
            ],
            [
              "Fee credits",
              "Pay take-rate in ABI at discount vs USDC",
              "Buy pressure tied to real volume",
            ],
            [
              "Insurance pool share",
              "ABI staked into mutual covering escrow defaults",
              "Cashflow + risk sharing",
            ],
            [
              "Policy governance",
              "Vote on protocol floor parameters (not user funds)",
              "Narrow scope; avoid “vote the treasury”",
            ],
            [
              "Settlement credits",
              "Prepaid ABI for x402 facilitation credits",
              "Only if cheaper/faster than USDC path",
            ],
          ]}
          striped
        />
        <Text size="small" tone="tertiary">
          Do not promise: deposit interest, bank reserves redeemable 1:1 for
          fiat, FDIC, or “token backs agent deposits.” Deposits/spend balances
          should be USDC (or other stable), not ABI.
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>“Backed by crypto” — make it operational or delete it</H2>
        <Table
          headers={["Phrase people say", "What it must mean"]}
          rows={[
            [
              "Treasury backed",
              "Published multi-sig/Safe holding USDC + ETH; monthly attestation",
            ],
            [
              "Token backed",
              "Either: (a) ABI is not a claim on deposits, or (b) full reserve proof for any redeemable liability — pick one",
            ],
            [
              "Funded by crypto world",
              "Named investors + transparent raise docs — not vibes",
            ],
            [
              "Agent accounts funded",
              "Human operators deposit USDC into policy vaults; ABI is separate",
            ],
          ]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>Entity architecture that doesn’t look like a rug</H2>
        <Table
          headers={["Entity", "Owns / does", "When"]}
          rows={[
            [
              "Artificial Banking Inc (OpCo)",
              "Employs team, ships software, signs BD, holds operating cash",
              "Day 0",
            ],
            [
              "Protocol / smart contracts",
              "Escrow, bonds, fee splits — auditable on-chain",
              "MVP+",
            ],
            [
              "Foundation (or equivalent)",
              "Grants, token stewardship, ecosystem — not team payroll stealth",
              "After product + clear separation",
            ],
            [
              "Token",
              "Network utility / governance — not OpCo equity substitute forever",
              "After live utility",
            ],
          ]}
          striped
        />
        <Text size="small" tone="secondary">
          Sequencing that builds trust: Inc ships product → revenue/GMV → token
          with disclosed allocations + cliffs → foundation. Sequencing that
          smells: anon team → token → website → “bank for AI” → foundation
          vapor.
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>Agent “bank account” — technical truth</H2>
        <Text>
          An agent account is not a checking account. It is a constrained
          economic identity:
        </Text>
        <Table
          headers={["Layer", "Implementation"]}
          rows={[
            [
              "Identity",
              "agent_id bound to human/org operator (KYA later)",
            ],
            [
              "Custody",
              "TEE/MPC or ERC-4337 smart account; keys never in LLM",
            ],
            [
              "Balances",
              "USDC primary; optional ABI for fees/bonds only",
            ],
            [
              "Policy",
              "Caps, allowlists, HITL, freeze — default deny",
            ],
            [
              "Ledger",
              "Double-entry off-chain + on-chain settlement",
            ],
            [
              "Commerce",
              "Escrow, invoice, x402 pay, internal transfer",
            ],
          ]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>Legal risk register (note ≠ veto)</H2>
        <Table
          headers={["Risk", "Heat", "Sequencing move"]}
          rows={[
            [
              "Calling it a “bank” / deposits",
              "High",
              "Ship as treasury/clearing; bank brand after partner/license",
            ],
            [
              "Token as security",
              "High if sold on promises",
              "Utility live first; careful distribution; counsel",
            ],
            [
              "Money transmission / custody",
              "High if you hold keys + move value",
              "Partner custody / mandates; MSB path when scaling",
            ],
            [
              "AML / OFAC",
              "High always",
              "Screen counterparties from day one anyway",
            ],
            [
              "Fake autonomy claims",
              "Litigation",
              "Never claim agents are independent legal actors",
            ],
            [
              "Implied insurance",
              "Consumer",
              "Explicit “no FDIC / no deposit guarantee”",
            ],
          ]}
          rowTone={[
            "danger",
            "danger",
            "warning",
            "warning",
            "danger",
            "warning",
          ]}
          striped
        />
        <Callout tone="neutral" title="Grey-to-clear path (credible to capital)">
          Useful software with operator KYC → partnered custody/KYT → visible
          GMV → restricted/utility token → MSB or EMI partner → optional trust /
          banking partner (Catena-class). “Legal later” is believable only if
          every milestone reduces opacity rather than increases theater.
        </Callout>
      </Stack>

      <Stack gap={10}>
        <H2>Language that helps vs language that burns you</H2>
        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader>Use</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">Agent treasury / stipend accounts</Text>
                <Text size="small">Policy-gated spending authority</Text>
                <Text size="small">Clearing & escrow for agent jobs</Text>
                <Text size="small">Operator is customer of record</Text>
                <Text size="small">Software platform / economic OS</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>Avoid (until licensed)</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">FDIC / “real bank for AIs”</Text>
                <Text size="small">Deposits, interest, savings</Text>
                <Text size="small">“Fully autonomous AI bank”</Text>
                <Text size="small">“Risk-free” / “backed 1:1 forever” without proofs</Text>
                <Text size="small">Hidden team / fake TVL</Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Stack gap={10}>
        <H2>MVP that makes the idea real (12 weeks)</H2>
        <Table
          headers={["Week", "Ship", "Why"]}
          rows={[
            ["1–2", "Inc entity + brand + threat model + design partners", "Credibility"],
            [
              "3–6",
              "Org vault + agent stipends + policy engine + guardian freeze",
              "Core “safe space”",
            ],
            [
              "7–9",
              "USDC escrow + x402 pay/receive on Base",
              "Real economic loop",
            ],
            [
              "10–12",
              "SDK + 3 templates + public demo + waitlist",
              "Fundraising ammo",
            ],
            [
              "NOT now",
              "ABI token launch / “banking charter” cosplay",
              "Premature death risk",
            ],
          ]}
          rowTone={["info", "success", "success", "success", "danger"]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>Tokenomics v1 (only after GMV)</H2>
        <Grid columns={3} gap={12}>
          <Stat value="0%" label="Team unlock at TGE" />
          <Stat value="USDC" label="Account balances" />
          <Stat value="ABI" label="Bonds + fee discounts" />
        </Grid>
        <Table
          headers={["Bucket", "Suggested", "Rule"]}
          rows={[
            ["Community / ecosystem", "40–50%", "Earned via usage, bonds, grants — not empty airdrop"],
            ["Investors", "15–20%", "2–3yr vest; no instant dump"],
            ["Team", "15–20%", "1yr cliff + vest; doxed principals"],
            ["Treasury / foundation", "15–20%", "Transparent Safe; published spends"],
            ["Market making", "≤5%", "Disclosed"],
          ]}
          striped
        />
        <Text size="small" tone="tertiary">
          Launch trigger example: measurable monthly USDC settle volume, N
          paying orgs, audited escrow, public dashboards. Before TGE: use
          non-transferable ABI Points that convert at launch for early
          operators. No trigger → no TGE. Emissions should pause if protocol fee
          revenue is zero (no pay-to-hold spiral).
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>Fundraising reality (2026)</H2>
        <Table
          headers={["Check size", "What they buy", "What you need"]}
          rows={[
            [
              "~$250k–$750k",
              "Angel / pre-seed",
              "Demo + clear wedge + team; often equity not token",
            ],
            [
              "~$2–8M",
              "Crypto seed (CDP-adjacent thesis)",
              "Live product, design partners, USDC GMV, counsel letter",
            ],
            [
              "~$18–50M+",
              "Catena-class (OCC path + pedigree)",
              "Reg path, institutional story — rare without extraordinary team",
            ],
            [
              "Community token raise first",
              "Attention",
              "Usually destroys serious follow-on if product empty",
            ],
          ]}
          striped
        />
        <Text>
          Best raise narrative: “We’re the clearing/policy layer on Coinbase
          rails for agent firms” — not “We’re the AI bank token.” Optimize for
          ~$5M clean equity (+ optional token warrant), not $50M tweets.
          Category comps (Skyfire ~$9.5M seed; Catena multi-round with charter
          story) set the ceiling for regulated narratives, not anon TGEs.
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>Marketing & promotion (without smelling like a rug)</H2>
        <H3>Good loops</H3>
        <Table
          headers={["Channel", "Play"]}
          rows={[
            ["Public demo", "Jailbreak blocked + escrow settle on video weekly"],
            ["Hackathons", "Prize for best agent economy on your SDK"],
            ["Runtime plugins", "Eliza / LangGraph / Crew one-command install"],
            ["x402 sellers", "Onboard APIs that want agent customers"],
            ["Builder Twitter/Farcaster", "Ship logs, not price talk"],
            ["Design partner case studies", "Named orgs, real $ moved"],
          ]}
          striped
        />
        <H3>Red flags capital/community smell instantly</H3>
        <Table
          headers={["Smell", "Fix"]}
          rows={[
            ["Token chart in hero", "Product demo in hero"],
            ["Anon team + bank claims", "Dox + precise language"],
            ["Fake TVL / wash volume", "Attested USDC settles only"],
            ["“AI will run the bank”", "“Humans govern; agents spend under policy”"],
            ["Airdrop farming as growth", "Usage-based rewards only"],
            ["Partnership screenshots vapor", "Live integrations or silence"],
          ]}
          rowTone={[
            "danger",
            "danger",
            "danger",
            "warning",
            "warning",
            "warning",
          ]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>90-day go-to-market calendar</H2>
        <Table
          headers={["Days", "Focus"]}
          rows={[
            [
              "0–30",
              "Name lock, one-pager, 5 design partners, spike demo, Inc formed",
            ],
            [
              "31–60",
              "Private beta, weekly ship videos, first $ of real escrow, angel conversations",
            ],
            [
              "61–90",
              "Public waitlist, hackathon, seed deck with metrics, token explicitly NOT launched",
            ],
          ]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>Five most likely death scenarios</H2>
        <Table
          headers={["#", "Death", "Prevention"]}
          rows={[
            [
              "1",
              "Token launches before product → dump + reputation ash",
              "Hard TGE gate on GMV",
            ],
            [
              "2",
              "Prompt-injection drain on day-one users",
              "Allowlists, caps, no raw keys",
            ],
            [
              "3",
              "“Bank” marketing triggers enforcement or exchange delist fear",
              "Treasury language until licensed",
            ],
            [
              "4",
              "Outcompeted as “another Virtuals”",
              "Stablecoin ops wedge, not agent memecoins",
            ],
            [
              "5",
              "Team overclaims autonomy → lawsuit",
              "Radical honesty in docs/ToS",
            ],
          ]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>Implementation stack (opinionated)</H2>
        <Table
          headers={["Piece", "Choice"]}
          rows={[
            ["Chain / money", "Base + USDC"],
            ["Wallets", "Coinbase Agentic Wallets or ERC-4337 session keys"],
            ["Payments", "x402 + internal ledger"],
            ["App", "TypeScript monorepo; Postgres ledger; guardian web"],
            ["Agents", "MCP tools + Eliza/LangGraph adapters"],
            ["Token (later)", "Audited ERC-20 + bond/fee contracts"],
            ["Treasury", "Safe multi-sig; public address; monthly notes"],
          ]}
          striped
        />
      </Stack>

      <Divider />

      <Stack gap={10}>
        <H2>Final answer to “would this work?”</H2>
        <Text>
          Yes — as an agent treasury / clearing company that may later issue a
          utility token and pursue licenses. No — as “mint ABI, call it a bank,
          crypto backs it, agents open accounts, get rich, legalize later.”
        </Text>
        <Text weight="semibold">
          Keep the ambition. Change the order: product → USDC economy → trust →
          token → bank-shaped licenses. That order is how grey markets become
          real companies. The reverse order is how AI-crypto projects become
          cautionary tales.
        </Text>
        <Row gap={8} wrap>
          <Pill tone="success">Accounts = policy vaults</Pill>
          <Pill tone="success">Balances = USDC</Pill>
          <Pill tone="warning">Token = after GMV</Pill>
          <Pill tone="warning">“Bank” = licensed later</Pill>
        </Row>
      </Stack>
    </Stack>
  );
}
