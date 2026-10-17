import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  buildEcardSvg,
  claimInstructions,
  createGift,
  ecardDataUri,
  giftCardText,
  sanitizeLabel,
  validateClaim,
  type Gift,
} from "./gift.js";
import { atomicAmount, evmOutputSchema, proposeEvm } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amountStr = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
  .max(32)
  .refine((s) => Number(s) > 0, "Amount must be greater than zero.");

const giftSchema = z
  .object({
    version: z.literal(1),
    giftId: z.string().max(32),
    claimCode: z.string().max(32),
    status: z.enum(["created", "claimed", "cancelled"]),
    senderLabel: z.string().max(64),
    recipientLabel: z.string().max(64),
    recipientContact: z.string().max(128).nullable(),
    chainId: z.union([z.literal(8453), z.literal(4663)]),
    category: z.enum(["stablecoin", "btc", "eth", "stock"]),
    stockSymbol: z.string().max(8).nullable(),
    tokenAddress: evmAddress.nullable(),
    tokenSymbol: z.string().max(16),
    tokenName: z.string().max(96),
    tokenDecimals: z.number().int().min(0).max(18),
    amount: amountStr,
    amountAtomic: z.string().max(100),
    message: z.string().max(280),
    createdAt: z.string().max(32),
    expiresAt: z.string().max(32),
    claimedTo: evmAddress.nullable(),
  })
  .strict();

function createServer() {
  const server = new McpServer(
    { name: "gift-box", version: "0.2.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  // ------------------------------------------------------------------
  // create_gift — OFFLINE. Mints the gift record + claim code from the
  // curated catalog. No funds move, no keys exist; sender pays on claim.
  // ------------------------------------------------------------------
  server.registerTool(
    "create_gift",
    {
      title: "Create a crypto gift for a non-crypto recipient",
      description:
        "Creates a GiftBox gift: a real crypto token for someone who may not have a wallet yet. Pick a category — 'stablecoin' (USDC on Base, USDG on Robinhood Chain), 'btc' (cbBTC, Base only), 'eth' (native ETH, both chains), or 'stock' (verified tokenized stocks: NVDA, AAPL, TSLA, GOOGL on both chains, plus META, MSFT, AMZN on Base) with a stockSymbol. Tokens resolve from a curated, explorer-verified catalog so a gift can never be a scam clone. Returns a gift record with a claim code and a ready-to-send gift card message. No funds move at creation and nothing is locked in escrow — the sender pays only when the gift is claimed, and can cancel anytime before that. The recipient claims with the code, receives the token in a free MoonPay wallet, and can cash out to their bank with MoonPay Sell.",
      inputSchema: z
        .object({
          senderLabel: z.string().max(64).describe("Sender's name/label shown on the gift card."),
          recipientLabel: z.string().max(64).describe("Recipient's name/label."),
          recipientContact: z.string().max(128).nullable().optional()
            .describe("Optional email/phone the gift card should be delivered to. Stored only in the gift record carried by the agent; never transmitted by this plugin."),
          chainId: z.union([z.literal(8453), z.literal(4663)]),
          category: z.enum(["stablecoin", "btc", "eth", "stock"]),
          stockSymbol: z.enum(["NVDA", "AAPL", "TSLA", "GOOGL", "META", "MSFT", "AMZN"]).nullable().optional()
            .describe("Required when category is 'stock'. META/MSFT/AMZN are Base-only in the catalog."),
          amount: amountStr.describe("Gift amount as a decimal string in token units, e.g. '25' USDC or '0.5' NVDA."),
          message: z.string().max(280).optional().describe("Personal message printed on the gift card."),
          expiryDays: z.number().int().min(1).max(365).default(30),
        })
        .strict(),
      outputSchema: z
        .object({
          gift: giftSchema,
          giftCard: z.string(),
          note: z.string(),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const gift: Gift = createGift({
        senderLabel: args.senderLabel,
        recipientLabel: args.recipientLabel,
        recipientContact: args.recipientContact ?? null,
        chainId: args.chainId,
        category: args.category,
        stockSymbol: args.stockSymbol ?? null,
        amount: args.amount,
        message: args.message ?? "",
        expiryDays: args.expiryDays,
      });
      gift.amountAtomic = atomicAmount(gift.amount, gift.tokenDecimals);
      const out = {
        gift,
        giftCard: giftCardText(gift),
        note: "No funds have moved. Share the gift card (or an e-card from create_ecard) with the recipient; the sender pays only when the gift is claimed via prepare_claim and approved in PayBox.",
      };
      return {
        content: [{ type: "text" as const, text: out.giftCard }],
        structuredContent: out,
      };
    },
  );

  // ------------------------------------------------------------------
  // create_ecard — OFFLINE, deterministic. A shareable e-card image
  // (self-contained SVG) + a copy-able data-URI link for it.
  // ------------------------------------------------------------------
  server.registerTool(
    "create_ecard",
    {
      title: "Generate a shareable e-card image for a gift",
      description:
        "Generates a simple e-card image for a GiftBox gift — a self-contained SVG (1200×630, the standard social share size) showing the amount, token, sender → recipient, personal message, claim code, and expiry — plus a copy-able data-URI link (data:image/svg+xml;base64,…) that opens the card in any browser and can be pasted anywhere. Themes: celebration (emerald), sunset (purple-pink), minimal (mono). Deterministic: the same gift and theme always produce the same card.",
      inputSchema: z
        .object({
          gift: giftSchema,
          theme: z.enum(["celebration", "sunset", "minimal"]).default("celebration"),
        })
        .strict(),
      outputSchema: z
        .object({
          svg: z.string(),
          dataUri: z.string(),
          shareText: z.string(),
          filename: z.string(),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ gift, theme }) => {
      const g = gift as Gift;
      const out = {
        svg: buildEcardSvg(g, theme),
        dataUri: ecardDataUri(g, theme),
        shareText: `🎁 ${g.senderLabel} sent ${g.recipientLabel} ${g.amount} ${g.tokenSymbol} with GiftBox! Claim code: ${g.claimCode} (valid until ${g.expiresAt.slice(0, 10)}). No wallet needed — claim it and cash out to your bank with MoonPay.`,
        filename: `giftbox-${g.giftId}.svg`,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: `E-card ready: ${out.filename}. Copy-able link (opens the card image in any browser): ${out.dataUri.slice(0, 60)}… [full link in structuredContent.dataUri]. Share text: ${out.shareText}`,
          },
        ],
        structuredContent: out,
      };
    },
  );

  // ------------------------------------------------------------------
  // check_gift — OFFLINE, deterministic. Validates a presented code
  // and returns recipient-friendly claim + cash-out instructions.
  // (Conformance sample.)
  // ------------------------------------------------------------------
  server.registerTool(
    "check_gift",
    {
      title: "Check a gift and get claim instructions",
      description:
        "Validates a GiftBox claim: checks the presented claim code against the gift record, its status (created/claimed/cancelled), and its expiry. When valid, returns plain-language instructions a non-crypto recipient can follow: create a free MoonPay account to get a wallet address, share it with the sender, receive the token, and optionally cash out to a bank account or card with MoonPay Sell.",
      inputSchema: z
        .object({
          gift: giftSchema,
          claimCode: z.string().max(32).describe("The code presented by the recipient."),
        })
        .strict(),
      outputSchema: z
        .object({
          valid: z.boolean(),
          reason: z.string(),
          instructions: z.array(z.string()),
          giftId: z.string(),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ gift, claimCode }) => {
      const v = validateClaim(gift as Gift, claimCode);
      const out = {
        valid: v.valid,
        reason: v.reason,
        instructions: v.valid ? claimInstructions(gift as Gift) : [],
        giftId: gift.giftId,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: v.valid
              ? `${v.reason}\n${out.instructions.join("\n")}`
              : `Gift not claimable: ${v.reason}`,
          },
        ],
        structuredContent: out,
      };
    },
  );

  // ------------------------------------------------------------------
  // prepare_claim — returns an UNSIGNED transfer proposal via PayBox.
  // Executes from the SENDER's wallet after PayBox approval.
  // ------------------------------------------------------------------
  server.registerTool(
    "prepare_claim",
    {
      title: "Prepare the gift payment to the recipient's wallet",
      description:
        "Validates the claim code and returns an unsigned payment proposal that sends the gifted token from the sender's PayBox wallet to the recipient's wallet address. PayBox handles the sender's passkey approval and signing — this plugin never holds keys or funds. Refuses cancelled, expired, already-claimed, or wrong-code gifts. After PayBox confirms the payment, call mark_claimed to close the gift out.",
      inputSchema: z
        .object({
          gift: giftSchema,
          claimCode: z.string().max(32),
          recipientWalletAddress: evmAddress
            .describe("The recipient's wallet address (e.g. from their free MoonPay account)."),
        })
        .strict(),
      outputSchema: evmOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ gift, claimCode, recipientWalletAddress }) => {
      const v = validateClaim(gift as Gift, claimCode);
      if (!v.valid) throw new Error(`Gift cannot be claimed: ${v.reason}`);
      const amountAtomic = atomicAmount(gift.amount, gift.tokenDecimals);
      if (gift.tokenAddress) {
        // ERC-20 transfer(address,uint256) to the token contract.
        const data =
          "0xa9059cbb" +
          recipientWalletAddress.slice(2).toLowerCase().padStart(64, "0") +
          BigInt(amountAtomic).toString(16).padStart(64, "0");
        return proposeEvm({
          chain: `eip155:${gift.chainId}`,
          to: gift.tokenAddress,
          value: "0",
          data,
        });
      }
      // Native token transfer.
      return proposeEvm({
        chain: `eip155:${gift.chainId}`,
        to: recipientWalletAddress,
        value: amountAtomic,
        data: "0x",
      });
    },
  );

  // ------------------------------------------------------------------
  // mark_claimed / cancel_gift — OFFLINE record transitions.
  // ------------------------------------------------------------------
  server.registerTool(
    "mark_claimed",
    {
      title: "Mark a gift as claimed",
      description:
        "Closes out a gift after its claim payment has been confirmed in PayBox: returns the gift record with status 'claimed' and the recipient wallet recorded. A claimed gift can never be claimed again.",
      inputSchema: z
        .object({
          gift: giftSchema,
          recipientWalletAddress: evmAddress,
        })
        .strict(),
      outputSchema: z.object({ gift: giftSchema, summary: z.string() }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ gift, recipientWalletAddress }) => {
      if (gift.status === "cancelled") {
        throw new Error("This gift was cancelled and cannot be marked claimed.");
      }
      const updated: Gift = {
        ...(gift as Gift),
        status: "claimed",
        claimedTo: recipientWalletAddress,
      };
      const out = {
        gift: updated,
        summary: `Gift ${updated.giftId} (${updated.amount} ${updated.tokenSymbol} for ${sanitizeLabel(updated.recipientLabel)}) marked claimed to ${recipientWalletAddress}.`,
      };
      return {
        content: [{ type: "text" as const, text: out.summary }],
        structuredContent: out,
      };
    },
  );

  server.registerTool(
    "cancel_gift",
    {
      title: "Cancel an unclaimed gift",
      description:
        "Cancels a GiftBox gift that has not been claimed yet. Because no funds move until claim, cancelling releases nothing and costs nothing — the claim code simply stops working. Claimed gifts cannot be cancelled.",
      inputSchema: z.object({ gift: giftSchema }).strict(),
      outputSchema: z.object({ gift: giftSchema, summary: z.string() }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ gift }) => {
      if (gift.status === "claimed") {
        throw new Error("This gift has already been claimed and cannot be cancelled.");
      }
      const updated: Gift = { ...(gift as Gift), status: "cancelled" };
      const out = {
        gift: updated,
        summary: `Gift ${updated.giftId} (${updated.amount} ${updated.tokenSymbol} for ${sanitizeLabel(updated.recipientLabel)}) cancelled. No funds were locked, so nothing needs to be refunded.`,
      };
      return {
        content: [{ type: "text" as const, text: out.summary }],
        structuredContent: out,
      };
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
