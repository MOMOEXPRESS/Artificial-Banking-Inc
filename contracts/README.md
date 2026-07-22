# ABINC — community / build token

Fixed-supply ERC-20 for **Artificial Banking Incorporated** fundraising / community float.

| | |
| --- | --- |
| **Name** | Artificial Banking |
| **Symbol** | `ABINC` |
| **Supply** | 1,000,000,000 (fixed, minted once to treasury) |
| **Decimals** | 18 |
| **Chain** | Base Sepolia → Base mainnet |
| **Extras** | Burnable, EIP-2612 Permit |

## What this is / isn’t

- **Is:** optional community token you can deploy and list later
- **Is not:** part of the guardian console, agent wallets, or USDC vaults
- **Is not:** a deposit claim, stablecoin, or bank product

Product money stays **USDC**. Keep that story straight in public posts.

## What I already built

- `src/AbincToken.sol` — contract
- `test/AbincToken.t.sol` — forge tests
- `script/DeployAbinc.s.sol` — deploy script
- `foundry.toml` — Base Sepolia + Base RPC / verify config

## What you do personally

You need a wallet with gas, a treasury address, and to run the deploy commands. I can’t hold your keys or broadcast from here.

### 1. One-time setup

```bash
# Foundry (if needed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

cd contracts
forge install   # pulls OpenZeppelin + forge-std into lib/
cp .env.example .env
```

Edit `.env`:

- `PRIVATE_KEY` — deployer (Sepolia faucet wallet is fine for test)
- `TREASURY` — address that receives **all** tokens (use a [Safe](https://safe.global) on mainnet)
- `BASESCAN_API_KEY` — for verified source on Basescan

### 2. Test

```bash
cd contracts
forge test -vv
```

### 3. Deploy Base Sepolia (practice)

Get Sepolia ETH on Base: https://www.alchemy.com/faucets/base-sepolia

```bash
cd contracts
set -a && source .env && set +a

forge script script/DeployAbinc.s.sol:DeployAbinc \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --verify \
  -vvvv
```

Save the logged contract address.

### 4. Deploy Base mainnet (when ready)

Fund the deployer with a little ETH on Base. Double-check `TREASURY`.

```bash
cd contracts
set -a && source .env && set +a

forge script script/DeployAbinc.s.sol:DeployAbinc \
  --rpc-url "$BASE_RPC_URL" \
  --broadcast \
  --verify \
  -vvvv
```

### 5. After deploy

1. Add liquidity yourself (Aerodrome / Uniswap on Base) if you want a market — **not** automated here on purpose  
2. Publish contract + Basescan link; say clearly it’s **not** part of the console  
3. Prefer locked LP + honest treasury disclosure if you’re raising from community

## Verify later (if `--verify` failed)

```bash
forge verify-contract <ADDRESS> src/AbincToken.sol:AbincToken \
  --chain base-sepolia \
  --constructor-args $(cast abi-encode "constructor(address)" $TREASURY) \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

Use `--chain base` for mainnet.

## Disclaimer

Not financial, legal, or securities advice. Deploying and marketing a token can have regulatory consequences depending on how you sell it. Product balances remain USDC — don’t imply ABINC backs agent deposits.
