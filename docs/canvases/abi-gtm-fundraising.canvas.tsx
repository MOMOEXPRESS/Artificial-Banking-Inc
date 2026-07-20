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
  useHostTheme,
} from "cursor/canvas";

export default function AbiGtmFundraising() {
  const { tokens } = useHostTheme();

  return (
    <Stack gap={28} style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <Stack gap={8}>
        <Row gap={8} align="center" wrap>
          <Pill tone="warning">Critical GTM</Pill>
          <Pill tone="neutral">Jul 2026</Pill>
          <Pill tone="info">Crypto-first OK · Bank claims not OK</Pill>
        </Row>
        <H1>Artificial Banking Inc — GTM, Capital & Marketing</H1>
        <Text tone="secondary">
          How to promote, raise, and launch without looking like a rug. Assumes
          mid-2026 stack (Base, USDC, x402, agent wallets) and a founder who
          wants a token. Honest bar: Catena already owns the “AI bank +
          charter” narrative with Circle pedigree and ~$48M raised.
        </Text>
      </Stack>

      <Callout tone="warning" title="Brutal one-liner">
        Calling yourself a bank before licenses + launching a token before
        product is the fastest way to get ignored by serious capital and farmed
        by KOLs. Crypto-native launch is fine. Fake banking + vibes token is
        not. Win as “policy treasury OS for agents,” then earn the right to
        bank-ish language and a token.
      </Callout>

      <Grid columns={4} gap={12}>
        <Stat value="$0.5M" label="Angels / friends if demo" tone="info" />
        <Stat value="$3–8M" label="Seed if real product + team" tone="success" />
        <Stat value="$18–30M" label="Category leaders (Catena)" />
        <Stat value="$50M+" label="Needs pedigree or revenue" tone="warning" />
      </Grid>

      <Divider />

      {/* 1. POSITIONING */}
      <Stack gap={10}>
        <H2>1. Positioning & narrative</H2>
        <Text>
          Attract builders with APIs and safety primitives. Attract capital with
          measurable agent economic activity and a clear path to compliance —
          not with “first AI bank” slogans that Catena already took.
        </Text>

        <Table
          headers={["Bad narrative (smells like rug)", "Good narrative (raises & retains)"]}
          columnAlign={["left", "left"]}
          rows={[
            [
              "“The first AI bank. Deposit with agents. ABI to the moon.”",
              "“Treasury + spend-policy OS so agents can pay/earn without draining the vault.”",
            ],
            [
              "“Unlicensed crypto bank for bots — licenses later lol.”",
              "“Non-custodial / partner-custody rails today; regulated path published; no deposit-taking claims.”",
            ],
            [
              "“Our token is the native currency of the agent economy.”",
              "“USDC settles. Token (if any) is for staking/governance/fee discounts after usage exists.”",
            ],
            [
              "“Virtuals but for banking — ape the launchpad.”",
              "“Integrates Virtuals/Eliza agents as customers of policy accounts — we are infra, not a memecoin factory.”",
            ],
            [
              "Anonymous team, Telegram-only, FDV $200M day 1.",
              "Doxxed builders, GitHub, live demo, public metrics dashboard, capped early FDV.",
            ],
          ]}
          rowTone={["danger", "danger", "danger", "warning", "danger"]}
          striped
        />

        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader trailing={<Pill tone="success" size="sm">Say this</Pill>}>
              Builder pitch (30s)
            </CardHeader>
            <CardBody>
              <Text size="small">
                Give every agent a policy-bound account: budgets, allowlists,
                escrow, audit trail. Plug into Coinbase CDP wallets + x402. Ship
                SDKs for Eliza/runtime frameworks. Humans remain guardian;
                agents execute inside hard limits.
              </Text>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill tone="info" size="sm">Say this</Pill>}>
              Investor pitch (30s)
            </CardHeader>
            <CardBody>
              <Text size="small">
                Rails exist (wallets, x402). The missing product is controlled
                economic agency at scale. We sell trust & policy to agent
                operators and agent frameworks. Token only after retention and
                fee volume prove demand — not as the product.
              </Text>
            </CardBody>
          </Card>
        </Grid>

        <Callout tone="info" title="Brand hygiene">
          Prefer “Artificial Banking” as a cheeky holding-company name in
          decks, not as a public claim of deposit insurance or banking
          services. Public product name should be neutral: AgentVault,
          PolicyBank (infra), GuardTreasury, etc. “Bank” in marketing without
          charter = regulatory magnet + scam signal.
        </Callout>
      </Stack>

      <Divider />

      {/* 2. FUNDRAISING */}
      <Stack gap={10}>
        <H2>2. Fundraising paths for THIS product</H2>
        <Text size="small" tone="secondary">
          Ranked for an AI-agent treasury/policy platform in 2026. Catena comps:
          $18M seed (a16z crypto + Circle Ventures + Coinbase Ventures), $30M
          Series A with OCC trust-bank filing. Skyfire: ~$9.5M seed (Coinbase
          Ventures + a16z CSX). You are not Catena unless you have that team.
        </Text>

        <Table
          headers={["Path", "Fit for ABI", "Pros", "Cons / when it fails"]}
          columnAlign={["left", "left", "left", "left"]}
          rows={[
            [
              "Angels (ex-crypto ops, AI founders, Base builders)",
              "Best first money",
              "Speed, advice, intros to CDP/x402 teams, soft diligence",
              "Small checks; if they are only ‘degen angels,’ next round gets harder",
            ],
            [
              "Crypto VCs (a16z crypto, Coinbase Ventures, Variant, Robot, etc.)",
              "Primary target once demo + metrics",
              "Brand halo, distribution, regulatory empathy, follow-on",
              "They have Catena/Skyfire already — need wedge (developer OS, open SDK, vertical) not ‘also an AI bank’",
            ],
            [
              "Equity seed (SAFE) + optional token warrant",
              "Cleanest structure",
              "Standard for infra; aligns with ‘product first’; warrant defers token risk",
              "Token FOMO delayed; must still show path to token utility later",
            ],
            [
              "SAFT / token primary",
              "Risky for US-facing bank-ish product",
              "Crypto-native capital, community alignment if done right",
              "Securities risk; ‘bank’ + SAFT looks worst-case to counsel; top VCs may pass or demand equity",
            ],
            [
              "Community raise (echo / Legion / allowlisted sale)",
              "Only after product + VC anchor",
              "Users become owners; marketing flywheel",
              "Without product = bagholders; KYC/geo mess; price discovery theater",
            ],
            [
              "Launchpad (Virtuals-style agent token pad)",
              "Poor primary raise; OK as channel later",
              "Distribution to agent-native audience",
              "Associates you with memecoin agents; kills ‘serious infra’ narrative; high wash volume culture",
            ],
          ]}
          rowTone={["success", "success", "success", "warning", "warning", "danger"]}
          striped
        />

        <H3>Recommended capital stack</H3>
        <Text>
          1) $400–750k angels on SAFE (build MVP). 2) $3–8M seed equity + token
          warrant from 1–2 crypto VCs who already know agent rails. 3)
          Community round only after live agents + public metrics. Skip
          launchpad as the fundraise vehicle.
        </Text>
      </Stack>

      <Divider />

      {/* 3. TOKEN */}
      <Stack gap={10}>
        <H2>3. Token launch strategy (if they insist)</H2>
        <Callout tone="danger" title="Default advice">
          Do not launch a liquid token before: (a) public testnet/mainnet with
          real agent operators, (b) measurable fee or escrow volume that is not
          team-funded, (c) published unlocks + audits, (d) counsel sign-off on
          what the token is NOT (not equity, not deposit claim). Pre-product
          token = usually bad for THIS category.
        </Callout>

        <Table
          headers={["Phase", "Token status", "Why"]}
          columnAlign={["left", "left", "left"]}
          rows={[
            [
              "Weeks 0–12 (MVP)",
              "No liquid token. Design doc only.",
              "Prove policy accounts + USDC flows. Selling ABI now = meme, not infra.",
            ],
            [
              "Months 4–9",
              "Testnet points / non-transferable credits OK",
              "Reward builders without creating secondary market dump pressure.",
            ],
            [
              "Post product-market signal",
              "TGE with utility + locks",
              "Need: weekly active agent accounts, organic x402 volume, retention.",
            ],
          ]}
          rowTone={["success", "info", "warning"]}
          striped
        />

        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader>Liquidity & listings that don’t scream exit</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">
                  • Prefer Base DEX first (Aerodrome/Uniswap) with locked LP —
                  not “CEX or die” day 1.
                </Text>
                <Text size="small">
                  • Market makers: hire transparent ones; disclose inventory and
                  mandate. Secret MM + thin book = classic dump setup.
                </Text>
                <Text size="small">
                  • Tier-1 CEX only after organic volume + compliance packet.
                  Paid listing before product is a red flag to sophisticated
                  buyers.
                </Text>
                <Text size="small">
                  • Seed liquidity sized to real float — not $50k LP under $80M
                  FDV.
                </Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>Unlock schedule that preserves trust</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">
                  • Team/investors: ≥12 month cliff, 24–36 month vest. Zero
                  team unlock at TGE.
                </Text>
                <Text size="small">
                  • Community/airdrop: ≤10–15% at TGE, rest streamed to usage
                  (stake, escrow fees paid, agents retained).
                </Text>
                <Text size="small">
                  • Ecosystem: milestone unlocks (SDK adoption, partner
                  integrations) — not calendar dumps.
                </Text>
                <Text size="small">
                  • Publish a vesting dashboard on day 1. Hide unlocks = assume
                  rug.
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>

        <Text size="small" tone="tertiary">
          Utility that survives skepticism: staking for policy/guardian
          operators, fee discounts in USDC terms, governance over risk
          parameters — not “ABI required to open an account” (that’s a death
          spiral and a securities/product smell).
        </Text>
      </Stack>

      <Divider />

      {/* 4. MARKETING */}
      <Stack gap={10}>
        <H2>4. Marketing channels (prove product, not vibes)</H2>
        <Table
          headers={["Channel", "What works", "What looks scammy"]}
          columnAlign={["left", "left", "left"]}
          rows={[
            [
              "X (crypto + AI)",
              "Thread demos, incident postmortems, weekly onchain metrics, founder AMA with code",
              "GM raids, ‘AI bank soon,’ engagement bait, fake partnership screenshots",
            ],
            [
              "Farcaster",
              "Frames for agent account creation, Base-native builders, cast demos",
              "Clone-of-X shill; token spam casts",
            ],
            [
              "Agent demos",
              "Live agent pays API via x402 under policy cap; failed spend when over limit",
              "Scripted ‘agent made $10k trading’ without verifiable wallets",
            ],
            [
              "Hackathons",
              "Sponsor Base/ETHGlobal/agent tracks; prize = integrate ABI SDK",
              "Pay-to-speak panels with no shippable SDK",
            ],
            [
              "KOLs / influencers",
              "Rarely. Prefer technical creators who fork your repo",
              "Paid shill waves before audit; undisclosed ads; ‘100x AI bank’ thumbnails",
            ],
            [
              "Content",
              "Architecture posts, threat models, open metrics, comparison vs CDP alone",
              "Whitepaper cosplay, roadmap vapor, AI-generated thought leadership",
            ],
          ]}
          rowTone={["info", "info", "success", "success", "danger", "success"]}
          striped
        />

        <Callout tone="warning" title="KOL risk specifically">
          For a bank-adjacent product, paid KOL campaigns are asymmetric
          downside. One rug-adjacent promo permanently tags you. If you buy
          reach, buy developer education (workshops, bounties), not price talk.
        </Callout>
      </Stack>

      <Divider />

      {/* 5. GROWTH LOOPS */}
      <Stack gap={10}>
        <H2>5. Growth loops (visible economy, not wash volume)</H2>
        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader trailing={<Pill tone="success" size="sm">Good loop</Pill>}>
              Agent → escrow → settlement → retention
            </CardHeader>
            <CardBody>
              <Text size="small">
                Operator creates agent account → sets policy → agent buys
                compute/API via x402 → completes job → escrow releases →
                dashboard shows unique counterparties + median ticket size.
                Referral: frameworks embed SDK → more agents inherit policy
                defaults.
              </Text>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill tone="deleted" size="sm">Bad loop</Pill>}>
              Fake TVL / circular agent trades
            </CardHeader>
            <CardBody>
              <Text size="small">
                Team wallets funding agents that pay each other to inflate
                “agent GDP.” Investors and crypto Twitter now discount this
                hard. Publish Sybil-resistant metrics: unique operator KYC/key,
                net external USDC inflows, fee revenue, retention cohorts.
              </Text>
            </CardBody>
          </Card>
        </Grid>

        <Table
          headers={["Metric to publish weekly", "Why it builds trust", "Easy to fake?"]}
          columnAlign={["left", "left", "left"]}
          rows={[
            ["Unique guardian/operator wallets", "Real humans using the product", "Medium"],
            ["External USDC net inflow (ex-team)", "Capital actually trusts the system", "Harder"],
            ["Escrow completions (counterparty ≠ same cluster)", "Real commerce", "Medium"],
            ["Policy-block events (failed overspends)", "Safety is working", "Hard to fake usefully"],
            ["DEX volume / FDV", "Mostly noise for infra", "Trivially gamed — de-emphasize"],
          ]}
          rowTone={["success", "success", "success", "info", "danger"]}
          striped
        />
      </Stack>

      <Divider />

      {/* 6. PARTNERSHIPS */}
      <Stack gap={10}>
        <H2>6. Partnership map</H2>
        <Text>
          Integrate, don’t compete with rails. Your wedge is policy + escrow +
          multi-agent budgets sitting on top.
        </Text>
        <Table
          headers={["Partner", "What you want", "What you give", "Risk"]}
          columnAlign={["left", "left", "left", "left"]}
          rows={[
            [
              "Coinbase CDP / Agentic Wallets",
              "Wallet, KYT, gas, Base distribution",
              "Policy UI/SDK that makes CDP wallets usable for multi-agent orgs",
              "You’re a thin wrapper if you don’t own policy depth",
            ],
            [
              "x402 sellers / facilitators",
              "Default settlement path for agent spend",
              "Policy-gated 402 clients; escrow patterns for multi-step jobs",
              "Protocol shifts; don’t fork x402 — extend",
            ],
            [
              "Eliza / runtime frameworks",
              "Distribution: every agent spawn = account",
              "First-class plugins, templates, bounties",
              "Framework churn; maintain 2–3, not 20",
            ],
            [
              "Skyfire KYA",
              "Agent identity / payment credentials",
              "Map KYA → guardian-bound accounts + spend policy",
              "Compete vs complement — position as policy consumer",
            ],
            [
              "Virtuals / Clanker ecosystems",
              "Agent operators as customers",
              "Safer treasuries for agent coins (optional)",
              "Brand contamination if you become ‘another agent coin’",
            ],
            [
              "Catena / ACK (reality check)",
              "Interop if open standards emerge",
              "Open policy schemas",
              "They own ‘regulated AI bank’ — don’t pick a branding fight",
            ],
          ]}
          rowTone={["success", "success", "success", "info", "warning", "warning"]}
          striped
        />
      </Stack>

      <Divider />

      {/* 7. 90-DAY CALENDAR */}
      <Stack gap={10}>
        <H2>7. 90-day launch calendar</H2>
        <Text size="small" tone="secondary">
          Assumes small team, crypto-native path, no token TGE in this window.
        </Text>

        <Grid columns={3} gap={12}>
          <Card>
            <CardHeader trailing={<Pill size="sm">Days 1–30</Pill>}>
              Credibility sprint
            </CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">• Rename public product away from “bank”</Text>
                <Text size="small">• Legal memo: what you will / won’t claim</Text>
                <Text size="small">• MVP: agent account + policy + USDC send under cap</Text>
                <Text size="small">• Public GitHub + threat model doc</Text>
                <Text size="small">• Angel SAFE close ($400–750k target)</Text>
                <Text size="small">• 5 design-partner operators (not KOLs)</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill size="sm" tone="info">Days 31–60</Pill>}>
              Builder distribution
            </CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">• Eliza/runtime plugin + CDP wallet path</Text>
                <Text size="small">• x402 pay demo (success + blocked spend)</Text>
                <Text size="small">• Hackathon sponsorship / bounty</Text>
                <Text size="small">• Weekly metrics dashboard live</Text>
                <Text size="small">• Seed conversations (not close yet)</Text>
                <Text size="small">• Points program design (non-transferable)</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill size="sm" tone="success">Days 61–90</Pill>}>
              Proof & raise
            </CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">• Escrow A2A job flow in production</Text>
                <Text size="small">• Skyfire KYA or equivalent identity hook</Text>
                <Text size="small">• Case study: 1 operator with real spend</Text>
                <Text size="small">• Seed raise open on metrics + demos</Text>
                <Text size="small">• Tokenomics v1 published as draft only</Text>
                <Text size="small">• Explicit: no TGE this quarter</Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>

        <H3>Week-by-week communication cadence</H3>
        <Table
          headers={["Week", "Ship", "Public post"]}
          columnAlign={["left", "left", "left"]}
          rows={[
            ["1–2", "Policy engine skeleton", "‘What we are not: a bank’ manifesto"],
            ["3–4", "First live demo video", "Hard spend-limit failure demo"],
            ["5–6", "SDK alpha", "Builder onboarding thread + repo"],
            ["7–8", "Hackathon presence", "Winning projects using accounts"],
            ["9–10", "Escrow beta", "Metrics dashboard unveil"],
            ["11–12", "Design-partner case study", "Seed raise announcement (if ready)"],
          ]}
          striped
        />
      </Stack>

      <Divider />

      {/* 8. RED FLAGS */}
      <Stack gap={10}>
        <H2>8. Red flags investors & community smell immediately</H2>
        <Table
          headers={["Red flag", "Why it kills trust", "How to avoid"]}
          columnAlign={["left", "left", "left"]}
          rows={[
            [
              "‘Licensed bank soon’ with no counsel/filing",
              "Securities + banking regulators + CT call you a scammer",
              "Publish exact legal status; partner bank or non-custodial only",
            ],
            [
              "Token before product",
              "Looks like exit liquidity seeking",
              "Points → product → warrant → TGE",
            ],
            [
              "Anonymous team + custody of funds",
              "Unrecoverable trust failure",
              "Doxx, multisig, third-party custody, or non-custodial",
            ],
            [
              "Huge FDV, tiny float, secret unlocks",
              "2021–2024 trauma is fresh",
              "Low initial float honesty + public vesting",
            ],
            [
              "Wash ‘agent volume’ dashboards",
              "Infra buyers check counterparties now",
              "Open methodology; exclude team clusters",
            ],
            [
              "Paid KOL blitz + Telegram VIP groups",
              "Retail-rug pattern match",
              "Devrel & demos only until seed closes",
            ],
            [
              "Competing head-on with Catena as ‘the AI bank’",
              "You lose the naming war and diligence",
              "Own developer policy OS niche",
            ],
            [
              "Guaranteed yields / deposit APY on ABI",
              "Ponzi signal + regulatory nuke",
              "No yield promises. Fees for services only.",
            ],
          ]}
          rowTone={[
            "danger",
            "danger",
            "danger",
            "danger",
            "warning",
            "warning",
            "warning",
            "danger",
          ]}
          striped
        />
      </Stack>

      <Divider />

      {/* 9. CAPITAL REALITY */}
      <Stack gap={10}>
        <H2>9. Honest capital reality (2026, this category)</H2>
        <Text>
          Same category, wildly different checks — driven by team pedigree,
          regulatory posture, and whether you already have rails partners —
          not by how hard you shill “AI bank.”
        </Text>

        <Table
          headers={["Raise size", "Who gets it in 2026", "What you must show", "Likelihood for typical founder"]}
          columnAlign={["left", "left", "left", "left"]}
          rows={[
            [
              "~$500k",
              "Angels, accelerators, small community SAFE",
              "Clear thesis, early demo, credible builders, legal awareness",
              "High if you ship weekly and don’t claim banking",
            ],
            [
              "~$5M (seed)",
              "Crypto VCs + strategic (CB Ventures-style)",
              "Working product, design partners, SDK adoption, metrics, clean equity docs, token warrant optional",
              "Medium — need wedge vs Catena/Skyfire/CDP",
            ],
            [
              "~$18–30M",
              "Category lead (Catena seed/A comps)",
              "Ex-Circle/fintech pedigree OR charter path + strong product + top-tier lead",
              "Low without extraordinary team/regulatory story",
            ],
            [
              "~$50M+",
              "Late seed / Series B territory for this niche",
              "Revenue, regulated entity progress, or breakout network effects",
              "Very low pre-product; don’t plan runway on this",
            ],
          ]}
          rowTone={["success", "info", "warning", "danger"]}
          striped
        />

        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader>What moves a check from $500k → $5M</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">• Live agents (not slides) paying under policy</Text>
                <Text size="small">• Named design partners + retention</Text>
                <Text size="small">• Differentiation memo vs CDP alone & Catena</Text>
                <Text size="small">• One strong lead VC who “gets” agent rails</Text>
                <Text size="small">• No premature token circus</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>What would be required for $50M fantasy</CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">• Founder with Circle/Anchorage/Stripe-level trust</Text>
                <Text size="small">• Active bank/trust charter process</Text>
                <Text size="small">• Material revenue or systemically important volume</Text>
                <Text size="small">• Or a multi-year platform monopoly narrative with proof</Text>
                <Text size="small" weight="semibold">
                  Otherwise: stop optimizing for $50M tweets; optimize for $5M
                  of clean capital.
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Divider />

      <Stack gap={10}>
        <H2>Actionable bottom line</H2>
        <Callout tone="success" title="Do this sequence">
          Position as policy/treasury OS → crypto-native MVP on Base/USDC/x402
          → angels → public metrics → seed equity (+ warrant) → partnerships
          (CDP, Eliza, Skyfire) → token only after usage. Marketing = demos and
          dashboards. Never sell banking you don’t have.
        </Callout>
        <Text size="small" tone="tertiary">
          Comps referenced: Catena Labs $18M seed (May 2025, a16z crypto) and
          $30M Series A (May 2026, Acrew + a16z crypto, OCC trust-bank filing);
          Skyfire ~$9.5M seed (Coinbase Ventures + a16z CSX). These set the
          ceiling for “AI-native finance” narratives — not for anonymous token
          launches.
        </Text>
        <Text size="small" tone="tertiary" style={{ color: tokens.text.tertiary }}>
          Not legal, securities, or financial advice. Banking and token raises
          need qualified counsel in every jurisdiction you touch.
        </Text>
      </Stack>
    </Stack>
  );
}
