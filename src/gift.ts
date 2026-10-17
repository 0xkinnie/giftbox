/**
 * GiftBox — crypto gifts for people who don't have a wallet yet.
 *
 * Picks up the "Paywall Ghost" idea and points it at gifting: send a real
 * crypto token to a friend or family member who has no wallet, and let
 * them cash out to their bank with MoonPay Sell.
 *
 * The model (deliberately custody-free, matching PayBox's design):
 *  - Gifts are created from a CURATED CATALOG only — stablecoins, BTC,
 *    ETH, and verified tokenized stocks. A curated catalog means an
 *    agent can never be tricked into gifting a scam clone: during
 *    catalog research a supply-cloned fake NVDA token was found trading
 *    on Robinhood Chain under the real token's name at a wrong price;
 *    only the CoinGecko-tracked, explorer-verified contract is listed.
 *  - create_gift mints a gift RECORD + claim code. No funds move and no
 *    keys exist anywhere — the plugin is stateless and the record is
 *    carried by the sender's agent, exactly like a gift card's details.
 *  - The recipient (non-crypto) creates a free MoonPay account, which
 *    gives them a wallet address, and shares the claim code + address.
 *  - prepare_claim validates the code and returns an UNSIGNED transfer
 *    proposal; PayBox executes it from the SENDER's wallet after the
 *    sender's passkey approval.
 *  - The recipient can then cash out with MoonPay Sell to their bank.
 *  - Unclaimed gifts cost nothing and lock nothing: cancel anytime, or
 *    let the gift expire.
 */

import { randomBytes } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Curated token catalog — every address verified 2026-10-17 against  */
/* the chain explorer and/or CoinGecko's tracked token list.           */
/* ------------------------------------------------------------------ */

export type ChainId = 8453 | 4663;
export type GiftCategory = "stablecoin" | "btc" | "eth" | "stock";
export type StockSymbol = "NVDA" | "AAPL" | "TSLA" | "GOOGL" | "META" | "MSFT" | "AMZN";

export interface CatalogToken {
  /** Friendly display symbol, e.g. "USDC", "cbBTC", "NVDA". */
  symbol: string;
  name: string;
  /** ERC-20 contract, or null for the chain's native token. */
  address: string | null;
  decimals: number;
}

const BASE_STOCKS: Record<string, CatalogToken> = {
  NVDA: { symbol: "NVDA", name: "NVIDIA tokenized stock (Coinbase B20)", address: "0xb20000000000000000000078ee7ce2fE4908108C", decimals: 8 },
  AAPL: { symbol: "AAPL", name: "Apple tokenized stock (Coinbase B20)", address: "0xb200000000000000000000C2e324d24d7eEcd1fb", decimals: 8 },
  TSLA: { symbol: "TSLA", name: "Tesla tokenized stock (Coinbase B20)", address: "0xb2000000000000000000001e800a7f5189430cD0", decimals: 8 },
  GOOGL: { symbol: "GOOGL", name: "Alphabet tokenized stock (Coinbase B20)", address: "0xb2000000000000000000002D0BA3164cc74f58B7", decimals: 8 },
  META: { symbol: "META", name: "Meta tokenized stock (Coinbase B20)", address: "0xB2000000000000000000008bC8786B856E61707C", decimals: 8 },
  MSFT: { symbol: "MSFT", name: "Microsoft tokenized stock (Coinbase B20)", address: "0xB200000000000000000000Ab99cFa739E253872B", decimals: 8 },
  AMZN: { symbol: "AMZN", name: "Amazon tokenized stock (Coinbase B20)", address: "0xb200000000000000000000d9192b6B456483C2E8", decimals: 8 },
};

const ROBINHOOD_STOCKS: Record<string, CatalogToken> = {
  NVDA: { symbol: "NVDA", name: "NVIDIA • Robinhood Token", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18 },
  AAPL: { symbol: "AAPL", name: "Apple • Robinhood Token", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18 },
  TSLA: { symbol: "TSLA", name: "Tesla • Robinhood Token", address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", decimals: 18 },
  GOOGL: { symbol: "GOOGL", name: "Alphabet Class A • Robinhood Token", address: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", decimals: 18 },
};

export const CATALOG: Record<
  ChainId,
  { stablecoin: CatalogToken; btc: CatalogToken | null; eth: CatalogToken; stocks: Record<string, CatalogToken> }
> = {
  8453: {
    stablecoin: { symbol: "USDC", name: "USD Coin", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    btc: { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    eth: { symbol: "ETH", name: "Ether (native)", address: null, decimals: 18 },
    stocks: BASE_STOCKS,
  },
  4663: {
    stablecoin: { symbol: "USDG", name: "Global Dollar", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
    // cbBTC exists on Robinhood Chain via Chainlink CCIP, but its contract
    // address could not be verified against an authoritative source during
    // catalog research, so BTC gifts are not offered on this chain rather
    // than risk wiring a payment to an unverified contract.
    btc: null,
    eth: { symbol: "ETH", name: "Ether (native)", address: null, decimals: 18 },
    stocks: ROBINHOOD_STOCKS,
  },
};

export function resolveToken(
  chainId: ChainId,
  category: GiftCategory,
  stockSymbol?: string | null,
): CatalogToken {
  const chain = CATALOG[chainId];
  if (category === "stablecoin") return chain.stablecoin;
  if (category === "eth") return chain.eth;
  if (category === "btc") {
    if (!chain.btc) {
      throw new Error(
        "BTC gifts are not available on Robinhood Chain in the GiftBox catalog yet (the cbBTC contract there is not verified in the catalog). Gift ETH, USDG, or a stock token on Robinhood Chain, or gift cbBTC on Base.",
      );
    }
    return chain.btc;
  }
  // stock
  if (!stockSymbol) {
    throw new Error(
      `category "stock" requires a stockSymbol — available on chain ${chainId}: ${Object.keys(chain.stocks).join(", ")}.`,
    );
  }
  const token = chain.stocks[stockSymbol.toUpperCase()];
  if (!token) {
    throw new Error(
      `Stock ${stockSymbol.toUpperCase()} is not in the GiftBox catalog on chain ${chainId}. Available: ${Object.keys(chain.stocks).join(", ")}.`,
    );
  }
  return token;
}

/* ------------------------------------------------------------------ */
/* Gift records                                                        */
/* ------------------------------------------------------------------ */

/** Unambiguous claim-code alphabet (no 0/O/1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type GiftStatus = "created" | "claimed" | "cancelled";

export interface Gift {
  version: 1;
  giftId: string;
  claimCode: string;
  status: GiftStatus;
  senderLabel: string;
  recipientLabel: string;
  recipientContact: string | null;
  chainId: ChainId;
  category: GiftCategory;
  stockSymbol: string | null;
  /** ERC-20 contract, or null for the chain's native token (ETH). */
  tokenAddress: string | null;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  /** Human amount as a decimal string, e.g. "25" or "0.5". */
  amount: string;
  /** Atomic amount as a decimal string. */
  amountAtomic: string;
  message: string;
  createdAt: string;
  expiresAt: string;
  claimedTo: string | null;
}

export interface CreateGiftInput {
  senderLabel: string;
  recipientLabel: string;
  recipientContact?: string | null;
  chainId: ChainId;
  category: GiftCategory;
  stockSymbol?: string | null;
  amount: string;
  message?: string;
  expiryDays: number;
}

function genCode(bytes: number, group: number): string {
  const raw = randomBytes(bytes);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const idx = (raw[i] ?? 0) % CODE_ALPHABET.length;
    out += CODE_ALPHABET.charAt(idx);
  }
  return out.match(new RegExp(`.{1,${group}}`, "g"))!.join("-");
}

export function createGift(input: CreateGiftInput, now = new Date()): Gift {
  const token = resolveToken(input.chainId, input.category, input.stockSymbol);
  const expires = new Date(now.getTime() + input.expiryDays * 86_400_000);
  return {
    version: 1,
    giftId: "gg_" + genCode(8, 8).toLowerCase().replace(/-/g, ""),
    claimCode: genCode(10, 5),
    status: "created",
    senderLabel: input.senderLabel,
    recipientLabel: input.recipientLabel,
    recipientContact: input.recipientContact ?? null,
    chainId: input.chainId,
    category: input.category,
    stockSymbol: input.category === "stock" ? (input.stockSymbol ?? "").toUpperCase() : null,
    tokenAddress: token.address,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    tokenDecimals: token.decimals,
    amount: input.amount,
    amountAtomic: "", // filled by the caller via atomicAmount (paybox.ts) — one source of truth
    message: input.message ?? "",
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    claimedTo: null,
  };
}

/** Normalize a presented claim code for comparison (case/space/dash-insensitive). */
export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export type GiftCheck =
  | { valid: true; reason: string }
  | { valid: false; reason: string };

export function validateClaim(
  gift: Gift,
  presentedCode: string,
  now = new Date(),
): GiftCheck {
  if (normalizeCode(presentedCode) !== normalizeCode(gift.claimCode)) {
    return { valid: false, reason: "Claim code does not match this gift." };
  }
  if (gift.status === "claimed") {
    return { valid: false, reason: "This gift has already been claimed." };
  }
  if (gift.status === "cancelled") {
    return { valid: false, reason: "This gift was cancelled by the sender." };
  }
  if (now.getTime() > Date.parse(gift.expiresAt)) {
    return {
      valid: false,
      reason: `This gift expired on ${gift.expiresAt.slice(0, 10)} and can no longer be claimed.`,
    };
  }
  return {
    valid: true,
    reason: `Gift is claimable: ${gift.amount} ${gift.tokenSymbol} for ${gift.recipientLabel}, valid until ${gift.expiresAt.slice(0, 10)}.`,
  };
}

/** Steps a non-crypto recipient follows to receive the gift and cash out. */
export function claimInstructions(gift: Gift): string[] {
  return [
    `1. Create a free MoonPay account at moonpay.com — it gives you a wallet address to receive the gift (no crypto experience needed).`,
    `2. Send the sender your wallet address together with the gift claim code (${gift.claimCode}).`,
    `3. The sender approves the gift payment in PayBox (passkey) and ${gift.amount} ${gift.tokenSymbol} is sent to your wallet on chain ${gift.chainId}.`,
    `4. To turn it into money in your bank: in MoonPay choose Sell, pick ${gift.tokenSymbol} and the amount, send it from your wallet to the MoonPay address shown, and MoonPay pays out to your bank account or card (min. sell about $20; bank-transfer fees from about 1%; payout from minutes to ~2 business days).`,
    `You can also simply keep the ${gift.tokenSymbol} in your wallet — it's yours either way.`,
  ];
}

/** The shareable gift-card message the sender gives the recipient. */
export function giftCardText(gift: Gift): string {
  const lines = [
    `🎁 You've received a crypto gift!`,
    `${gift.senderLabel} sent you ${gift.amount} ${gift.tokenSymbol}${gift.message ? ` — "${gift.message}"` : ""}`,
    `Claim code: ${gift.claimCode}`,
    `Gift ID: ${gift.giftId}`,
    `Valid until: ${gift.expiresAt.slice(0, 10)}`,
    ``,
    `How to claim (no wallet needed yet):`,
    ...claimInstructions(gift),
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* E-card image (self-contained SVG, 1200×630 share format)            */
/* ------------------------------------------------------------------ */

export type EcardTheme = "celebration" | "sunset" | "minimal";

const THEMES: Record<EcardTheme, { from: string; to: string; fg: string; sub: string; pill: string }> = {
  celebration: { from: "#064e3b", to: "#0ea371", fg: "#ecfdf5", sub: "#a7f3d0", pill: "#052e22" },
  sunset: { from: "#4c1d95", to: "#db2777", fg: "#fdf4ff", sub: "#f5d0fe", pill: "#3b0764" },
  minimal: { from: "#18181b", to: "#3f3f46", fg: "#fafafa", sub: "#d4d4d8", pill: "#09090b" },
};

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(s: string, perLine: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length === maxLines) break;
    } else cur += " " + w;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  const last = lines[maxLines - 1];
  if (lines.length === maxLines && last !== undefined && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = last.replace(/…?$/, "") + "…";
  }
  return lines;
}

export function buildEcardSvg(gift: Gift, theme: EcardTheme): string {
  const t = THEMES[theme];
  const msgLines = gift.message ? wrapText(sanitizeLabel(gift.message, 140), 52, 2) : [];
  const msgSvg = msgLines
    .map((l, i) => `<text x="600" y="${392 + i * 34}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" fill="${t.sub}" font-style="italic">"${xmlEsc(l)}"</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.from}"/><stop offset="1" stop-color="${t.to}"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<text x="600" y="128" text-anchor="middle" font-size="86">🎁</text>
<text x="600" y="196" text-anchor="middle" font-family="system-ui, sans-serif" font-size="34" fill="${t.sub}" letter-spacing="4">YOU'VE RECEIVED A GIFT</text>
<text x="600" y="290" text-anchor="middle" font-family="system-ui, sans-serif" font-size="84" font-weight="700" fill="${t.fg}">${xmlEsc(gift.amount)} ${xmlEsc(gift.tokenSymbol)}</text>
<text x="600" y="340" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" fill="${t.sub}">${xmlEsc(sanitizeLabel(gift.senderLabel))} → ${xmlEsc(sanitizeLabel(gift.recipientLabel))} · ${xmlEsc(gift.tokenName)}</text>
${msgSvg}
<rect x="400" y="452" width="400" height="62" rx="31" fill="${t.pill}"/>
<text x="600" y="493" text-anchor="middle" font-family="ui-monospace, monospace" font-size="30" letter-spacing="3" fill="${t.fg}">CODE: ${xmlEsc(gift.claimCode)}</text>
<text x="600" y="572" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" fill="${t.sub}">GiftBox · gift id ${xmlEsc(gift.giftId)} · claim by ${gift.expiresAt.slice(0, 10)} · cash out to your bank with MoonPay</text>
</svg>`;
}

export function ecardDataUri(gift: Gift, theme: EcardTheme): string {
  return "data:image/svg+xml;base64," + Buffer.from(buildEcardSvg(gift, theme), "utf8").toString("base64");
}

/** Sanitize a label for display: strip control/invisible chars, cap length. */
export function sanitizeLabel(s: string, max = 64): string {
  const cleaned = s
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned || "—";
}
