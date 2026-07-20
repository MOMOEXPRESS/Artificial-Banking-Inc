import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from "cursor/canvas";

export default function AbiStressTestBriefing() {
  return (
    <Stack gap={28} style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <Stack gap={8}>
        <Row gap={8} align="center" wrap>
          <Pill tone="deleted">Ruthless stress-test</Pill>
          <Pill tone="neutral">Mid-2026</Pill>
          <Pill tone="warning">Legal = risk, not veto</Pill>
        </Row>
        <H1>ABI — blunt briefing</H1>
        <Text tone="secondary">
          Artificial Banking Inc: entity + token + AI agent “bank accounts” +
          crypto-backed + foundation later + licenses later. No soft-pedaling.
        </Text>
      </Stack>

      <Callout tone="danger" title="Verdict: Viable-if-pivoted (as packaged: High failure)">
        The demand is real. The packaging is mostly wrong. As stated — bank
        brand + liquid token + “backed by crypto” + legalize later — this is a
        high-failure path that collapses into either (a) a memecoin with a
        banking costume, or (b) a me-too wallet UI under Coinbase/Catena/Bankr.
        Survivable form: policy-gated agent treasury OS on USDC/x402 first,
        prove real GMV, then utility token, then bank-shaped licenses. Same
        ambition, inverted sequence.
      </Callout>

      <Grid columns={4} gap={12}>
        <Stat value="Pivot" label="Required" tone="warning" />
        <Stat value="High" label="Failure if unpivoted" tone="danger" />
        <Stat value="USDC" label="Real money layer" />
        <Stat value="Token≠Bank" label="Core fallacy" tone="danger" />
      </Grid>

      <Stack gap={10}>
        <H2>1. Works vs wishful</H2>
        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader trailing={<Pill tone="success" size="sm">Keep</Pill>}>
              What works
            </CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">
                  Agents need spendable treasuries, budgets, escrow, pay-per-API
                </Text>
                <Text size="small">
                  Human guardian + policy + freeze = actual buyer pain
                </Text>
                <Text size="small">
                  Inc as OpCo shipping software is a normal company
                </Text>
                <Text size="small">
                  Base + USDC + x402 + AA/TEE wallets are production rails
                </Text>
                <Text size="small">
                  “Legal later” for crypto product is common — if opacity falls
                  every quarter
                </Text>
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill tone="deleted" size="sm">Kill</Pill>}>
              Wishful
            </CardHeader>
            <CardBody>
              <Stack gap={6}>
                <Text size="small">
                  Launching a token creates a bank (it creates a ticker)
                </Text>
                <Text size="small">
                  “Backed by crypto” as a trust slogan without reserve policy
                </Text>
                <Text size="small">
                  Agents as depositors / legal customers of a bank
                </Text>
                <Text size="small">
                  Token price as proof the platform works (often inverse)
                </Text>
                <Text size="small">
                  Out-sloganing Coinbase / Catena / Virtuals / Bankr
                </Text>
                <Text size="small">
                  Foundation + licenses as post-hoc laundry for a speculative
                  raise
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Stack gap={10}>
        <H2>2. Why token = bank fails</H2>
        <Text>
          A bank is a regulated balance-sheet business: deposits, liabilities,
          capital, prudential rules, deposit insurance optics, examiners. A
          token is a transferable claim on narrative + optional utility. Mixing
          them is not “synergy” — it is category error that attracts the worst
          of both worlds: securities heat and banking heat, with neither
          franchise.
        </Text>
        <Table
          headers={["Claim", "Reality"]}
          rows={[
            [
              "ABI token = capital of the bank",
              "Unless you are a licensed institution with disclosed reserves and liability accounting, it is equity theater / speculative float",
            ],
            [
              "Agent balances in ABI",
              "Users hold volatility as “money.” One dump = bank run optics + refund rage. Real spend balances must be USDC (or other stable)",
            ],
            [
              "Token “backs” accounts",
              "Backing means redeemable reserves or legal capital. Speculative token backing is circular: price falls → “backing” evaporates → more selling",
            ],
            [
              "Bank brand sells the token",
              "Yes short-term. Then enforcement risk, exchange delist fear, and serious capital refusal. You bought attention with a liability",
            ],
            [
              "Token launches → network effects → bank",
              "Observed 2024–26 pattern: token launches → wash volume → credibility ash → no path to charter partners",
            ],
          ]}
          rowTone={["danger", "danger", "danger", "warning", "danger"]}
          striped
        />
        <Text weight="semibold">
          Bottom line: token-first “AI Bank” is not a clever grey-market
          sequencing — it is the highest-failure packaging of a real product
          idea.
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>3. When a token does work</H2>
        <Text>
          After a USDC economic loop exists. Token demand must be forced by
          usage, not by hope.
        </Text>
        <Table
          headers={["Utility", "Forced demand?", "Notes"]}
          rows={[
            [
              "Slashable agent/seller bonds",
              "Yes",
              "Best: skin in game to access tiers / marketplace",
            ],
            [
              "Fee discount vs USDC take-rate",
              "Yes if volume real",
              "Buy pressure tied to GMV; don’t make ABI the only payment rail",
            ],
            [
              "Insurance / mutual pool share",
              "Conditional",
              "Only with real coverage rules + payouts",
            ],
            [
              "Narrow protocol parameter votes",
              "Weak alone",
              "Governance ≠ product; never “vote the user treasury”",
            ],
            [
              "Memecoin / points → airdrop farm",
              "No",
              "Buys mercenaries; destroys follow-on from serious capital",
            ],
          ]}
          rowTone={["success", "success", "info", "warning", "danger"]}
          striped
        />
        <Callout tone="warning" title="Hard gate">
          No transferable ABI until measurable monthly USDC settlement, N real
          operator orgs, audited escrow, public dashboards. Before that: points
          only. Team unlock at TGE = 0%. Deposits stay USDC forever.
        </Callout>
      </Stack>

      <Stack gap={10}>
        <H2>4. “Backed by crypto” — decode or delete</H2>
        <Table
          headers={["If you say…", "It must mean…", "Else"]}
          rows={[
            [
              "Treasury backed",
              "Named Safe/multisig, assets listed, monthly attestation",
              "Vapor",
            ],
            [
              "Accounts funded",
              "Operators deposit USDC into policy vaults",
              "Agent “magic money”",
            ],
            [
              "Token backed",
              "ABI is NOT a claim on deposits — say that loudly",
              "Implied bank reserve fraud",
            ],
            [
              "Crypto-backed bank",
              "Either: stablecoin treasury + custody partners, or licensed capital",
              "Marketing crime scene",
            ],
          ]}
          rowTone={["info", "success", "warning", "danger"]}
          striped
        />
        <Text size="small" tone="secondary">
          Phrase to retire until precise: “backed by the crypto world.” Investors
          hear “vibes.” Regulators hear “unregistered bank.” Builders hear
          “rug.”
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>5. Entity sequencing (trust order)</H2>
        <Table
          headers={["Order", "Entity / layer", "Job"]}
          rows={[
            [
              "1",
              "Artificial Banking Inc (OpCo)",
              "Hire, ship, BD, hold operating cash — Day 0",
            ],
            [
              "2",
              "Protocol / contracts",
              "Escrow, policy vaults, fee split — auditable",
            ],
            [
              "3",
              "Custody / MSB partners",
              "When you touch keys or fiat on/off — before scale",
            ],
            [
              "4",
              "Token (utility)",
              "Only after GMV; disclosed allocations + cliffs",
            ],
            [
              "5",
              "Foundation",
              "Grants / stewardship after product — not payroll stealth",
            ],
            [
              "6",
              "Licenses / charter path",
              "After real usage + clean books — Catena-class ambition",
            ],
          ]}
          striped
        />
        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader>Credible sequence</CardHeader>
            <CardBody>
              <Text size="small">
                Inc → product → USDC GMV → partners → token → foundation →
                licenses
              </Text>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>Death sequence</CardHeader>
            <CardBody>
              <Text size="small">
                Anon → token → “AI bank” site → wash volume → foundation vapor →
                “licenses later”
              </Text>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Stack gap={10}>
        <H2>6. Mid-2026 competitor kill-map</H2>
        <Text size="small" tone="secondary">
          Sources: Coinbase/x402 Foundation (Linux Foundation, Visa/MC/Ripple
          etc.); Catena Series A ~$30M + OCC trust bank filing (~$48M total);
          Virtuals agent tokenization + ACP; Bankr wallets/launchpad/x402 cloud.
          Volumes for x402 remain small vs narrative (~$24M / 30d reported mid-Jul
          2026; earlier months showed heavy wash).
        </Text>
        <Table
          headers={["Player", "What they own", "ABI if you copy them", "ABI wedge vs them"]}
          rows={[
            [
              "Coinbase",
              "Agentic wallets, TEEs, spend caps, KYT, AgentKit, distribution",
              "You are a thin UI on their rails",
              "Vertical policy/treasury UX for multi-agent orgs — not another wallet",
            ],
            [
              "x402",
              "Open HTTP payment standard; foundation with card giants",
              "You cannot out-standard them",
              "Be a first-class consumer/producer of x402, not a competing protocol",
            ],
            [
              "Catena",
              "Governance + banking for agents; charter path; Circle pedigree; $48M",
              "You lose the “real bank” narrative cold",
              "Ship faster as software: escrow/policy OS without waiting for OCC",
            ],
            [
              "Virtuals",
              "Agent tokens, launchpad, $VIRTUAL routing, ACP commerce theater",
              "You become another agent-memecoin pad",
              "Stablecoin ops + bonds, not agent ticker casino",
            ],
            [
              "Bankr",
              "NL trading terminal, wallets, token launch → fee → LLM loop",
              "You compete on degens + self-sustaining agent memes",
              "Enterprise guardian controls, audit trails, org vaults — not chat-trade",
            ],
          ]}
          striped
        />
        <Callout tone="info" title="Strategic honesty">
          The category already has: rails (Coinbase/x402), regulated bank attempt
          (Catena), agent capital markets (Virtuals), and agent terminal/launchpad
          (Bankr). ABI’s only non-suicidal slot is the boring middle:{" "}
          <Text as="span" weight="semibold" size="small">
            policy-gated multi-agent treasury + escrow clearing for operators who
            need sleep-at-night controls
          </Text>
          . That is less sexy than “AI Bank Token.” It is also the only story
          that doesn’t automatically lose to someone bigger.
        </Callout>
      </Stack>

      <Stack gap={10}>
        <H2>7. Five death scenarios</H2>
        <Table
          headers={["#", "Death", "Why likely", "Prevention"]}
          rows={[
            [
              "1",
              "Token before product",
              "Fastest attention; classic 2025–26 AI-crypto dump pattern",
              "Hard GMV gate; points only until then",
            ],
            [
              "2",
              "Prompt-injection / policy bypass drain",
              "LLM + keys + money = first-week incident",
              "Allowlists, caps, TEE/AA, never keys in model context",
            ],
            [
              "3",
              "Bank language enforcement / delist heat",
              "“Bank” + deposits + token = radioactive cocktail",
              "Treasury/clearing language until licensed partner",
            ],
            [
              "4",
              "Narrative collision with Virtuals/Bankr",
              "Market already priced “agent token” as speculative",
              "USDC ops wedge; refuse agent-memecoin identity",
            ],
            [
              "5",
              "Autonomy overclaim → lawsuit / trust death",
              "ElizaOS-class optics still in memory",
              "Operator is customer of record; agents are tools under policy",
            ],
          ]}
          rowTone={["danger", "danger", "danger", "warning", "danger"]}
          striped
        />
      </Stack>

      <Stack gap={10}>
        <H2>8. Three strongest reframes</H2>
        <Table
          headers={["#", "Reframe", "Pitch", "Token"]}
          rows={[
            [
              "1",
              "PolicyVault OS (best)",
              "Fund agent swarms safely; guardians sleep. Org vaults, stipends, freeze.",
              "None at MVP; optional later",
            ],
            [
              "2",
              "Agent Clearinghouse (strong)",
              "Escrow + settle A2A jobs; take rate in USDC on Base/x402.",
              "ABI as bond/fee share after GMV",
            ],
            [
              "3",
              "Artificial Banking Inc token day-one (weak)",
              "“The AI bank of the crypto world.”",
              "Primary product = speculative — high failure",
            ],
          ]}
          rowTone={["success", "info", "danger"]}
          striped
        />
        <Text>
          Keep “Artificial Banking Inc” as the legal OpCo name if you want.
          Product brand should not say bank until you have partners or a
          charter. Ambition stays; costume changes.
        </Text>
      </Stack>

      <Stack gap={10}>
        <H2>9. Legal (risk register, not veto)</H2>
        <Table
          headers={["Risk", "Heat", "Live with it how"]}
          rows={[
            [
              "Bank / deposit language",
              "High",
              "Rename surfaces; bank claims only post-license",
            ],
            [
              "Token as security",
              "High if sold on promises",
              "Utility live first; counsel; careful distribution",
            ],
            [
              "Custody / money transmission",
              "High at scale",
              "Partner custody early; MSB path when volume forces it",
            ],
            [
              "AML / OFAC",
              "Always",
              "Screen from day one — not optional grey",
            ],
            [
              "Implied FDIC / insurance",
              "Consumer",
              "Explicit disclaimers; no deposit interest cosplay",
            ],
          ]}
          rowTone={["danger", "danger", "warning", "warning", "warning"]}
          striped
        />
        <Text size="small" tone="secondary">
          Grey-to-clear is fine. Grey-to-darker (more theater, less product) is
          how you die. Every milestone should reduce opacity.
        </Text>
      </Stack>

      <Divider />

      <Stack gap={10}>
        <H2>One-line close</H2>
        <Text weight="semibold">
          Viable-if-pivoted: agent treasury/clearing company → USDC economy →
          utility token → licenses. High failure: mint ABI, call it a bank,
          claim crypto backing, hope legalization cleans it up.
        </Text>
        <Row gap={8} wrap>
          <Pill tone="success">Accounts = policy vaults</Pill>
          <Pill tone="success">Balances = USDC</Pill>
          <Pill tone="warning">Token after GMV</Pill>
          <Pill tone="deleted">Bank brand last</Pill>
        </Row>
      </Stack>
    </Stack>
  );
}
