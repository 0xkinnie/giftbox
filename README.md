# GiftBox

**Crypto gifts for people who don't do crypto.**

GiftBox is a plugin for [PayBox](https://developer.paybox.sh) (MoonPay's non-custodial credential vault for AI agents). It turns real crypto into a gift anyone can receive: stablecoins, BTC, ETH, and tokenized stocks from a curated, verified catalog. Built for the MoonPay PayBox Hackathon, Chapter 1.

**▶ Demo video:** [Watch on X](https://x.com/0xkinnie/status/2111528993539383359)

## How it works

1. **Ask your agent.** Name the recipient and the gift.
2. **Pick a verified token.** USDC, USDG, cbBTC, ETH, or a tokenized stock.
3. **They get a gift card.** GiftBox creates the gift record, an e-card image, and a claim code.
4. **They claim it.** The recipient opens a free MoonPay account to get a wallet address, then shares the address and the claim code.
5. **You approve.** The transfer is prepared as an unsigned proposal and executed by your PayBox wallet after your passkey approval. The recipient can hold the token or cash out to a bank account or card with MoonPay Sell.

## Custody model

GiftBox never holds funds or keys.

- `create_gift` mints a gift record and a claim code. No funds move and nothing is escrowed.
- `prepare_claim` returns an **unsigned** EVM transfer proposal. PayBox executes it from the sender's wallet after passkey approval.
- Unclaimed gifts cost nothing, can be cancelled anytime, and expire.
- The plugin is stateless and fully offline: no network hosts, no API keys, no secrets. The gift record, carried by the agent, is the state.

## Tools

| Tool | What it does |
|---|---|
| `create_gift` | Create a gift from a category (stablecoin, BTC, ETH, stock) resolved against the verified catalog. Computes the atomic amount. |
| `create_ecard` | Generate a deterministic SVG gift e-card (1200×630) plus a copyable data-URI link. Three themes. |
| `check_gift` | Validate a gift record and claim code, with plain-language claim instructions. |
| `prepare_claim` | Validate and return the unsigned transfer proposal (ERC-20 `transfer` calldata, or a native value transfer). Refuses wrong codes and claimed, cancelled, or expired gifts. |
| `mark_claimed` | Mark a gift as claimed. Refuses cancelled gifts. |
| `cancel_gift` | Cancel an unclaimed gift. Refuses claimed gifts. |

## The catalog

Every contract was verified against chain explorers and CoinGecko's tracked-token list (2026-10-17).

| Category | Base (8453) | Robinhood Chain (4663) |
|---|---|---|
| Stablecoin | USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (6 dp) | USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 dp) |
| BTC | cbBTC `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` (8 dp) | Not offered (see below) |
| ETH | Native ETH (18 dp) | Native ETH (18 dp) |
| Stocks | Coinbase B20 (8 dp): NVDA, AAPL, TSLA, GOOGL, META, MSFT, AMZN | Robinhood Token (18 dp): NVDA, AAPL, TSLA, GOOGL |

Two deliberate refusals, by design:

- **BTC on Robinhood Chain is refused.** cbBTC trades there via Chainlink CCIP, but its contract address could not be verified from an authoritative source, so the catalog refuses rather than guess.
- **Clone contracts can never be gifted.** During research, a supply-cloned fake "NVIDIA · Robinhood Token" was found trading about 3% off the real price. The catalog lists only the verified, CoinGecko-tracked contract.

MoonPay Sell cash-out (verified 2026-10-17): bank account or Mastercard/Visa card, ~$20 minimum sell, fees from ~1% for bank transfer, payout from minutes to about two business days.

## Build and test

```bash
pnpm install
pnpm test   # typecheck, deterministic double-build, conformance, sample tool call
```

The bundle is a single `dist/plugin.mjs` (≤10 MiB), uploaded to the PayBox developer portal as-is. Portal configuration needs **no network hosts and no secrets**.

Also in this repo: `dashboard.html`, a standalone test dashboard with category and stock pickers, e-card preview, and share links that prefill the claim box. `DESCRIPTIONS.md` holds the store copy.

## Status

Submitted to the PayBox Hackathon, Chapter 1 (October 2026). All portal checks and tool tests passed, including a wallet-validated transaction preview. Demo video posted on X: https://x.com/0xkinnie/status/2111528993539383359

By [@0xkinnie](https://x.com/0xkinnie).
