// Paragon: scan-receipt
// Receives a receipt photo from a signed-in user, checks their monthly scan limit,
// asks Claude (Anthropic API) to read it and returns structured JSON.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CATEGORIES = [
  "bakery", "dairy", "meat", "produce", "pantry", "snacks", "drinks", "alcohol", "household",
  "hygiene", "clothes_and_shoes", "transport", "eating_out", "health", "leisure", "housing", "child_care",
  "pet_care", "telecommunications", "insurance_financial", "education", "arts_culture",
  "sports_fitness", "specialized_equipment", "car_expenses", "other",
];

const PROMPT = `The image is a photo of a shopping receipt (any country or language). Extract its contents.
Reply with only JSON in exactly this shape, no other text:
{"store": string, "date": "YYYY-MM-DD" or null, "total": number or null,
 "items": [{"name": string, "product": string, "category": string, "kind": "product"|"deposit"|"deposit_return", "qty": number, "unit": "pcs"|"kg"|"l", "unitPrice": number, "price": number, "discount": number}],
 "receiptDiscounts": [{"name": string, "amount": number}]}
Rules:
- "name": the line text as printed.
- "product": a short generic product name in English, lowercase, without brand, size or pack count, so the same item can be matched across shops (e.g. "milk", "gouda cheese", "bread rolls", "toothpaste", "sparkling water").
- "category": one of ${CATEGORIES.join(", ")}.
- "price": the final amount paid for that line, after any discount on it.
- "discount": how much an offer saved on that line, as a positive number (0 when none). Discount / Rabatt / rabat / korting / Bonus / promotion / "2 for 1" lines are never items of their own: add their amount to the "discount" of the product they belong to (usually the line just above) and lower that product's "price" by it.
- "receiptDiscounts": discounts on the whole receipt that don't belong to one product (a coupon, % off the total, loyalty points redeemed as money), each with a positive "amount". Use [] when there are none.
- Loyalty and bonus cards are never products. Lines that only show or register a card (e.g. Bonuskaart, AH Bonus, Payback, Lidl Plus, Clubcard, Moja Biedronka, DeutschlandCard, a card or member number, "card scanned"), points earned and points balances are not items: leave them out. If such a line carries a money amount off (e.g. "Bonus -0,50", "Lidl Plus Rabatt -1,00"), treat it as a discount by the rule above, never as an item.
- "kind": "product" for everything bought. A bottle deposit paid (Pfand, statiegeld, kaucja) is its own item with kind "deposit", product "bottle deposit", category "other". A deposit refund or empties return (Leergut, emballage, statiegeld retour, zwrot kaucji) is its own item with kind "deposit_return", product "deposit return", category "other", and a negative "price". Deposits are not discounts.
- "qty" x "unitPrice" = "price" (approximately). Weighed goods use unit "kg".
- Skip VAT/PTU/MwSt/BTW summaries, subtotals, payment method, change and card payment slips.
- "total": the grand total printed on the receipt. Numbers use a dot as decimal separator, no currency symbols.
- If the image is not a receipt, reply {"error": "not a receipt"}.`;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BASE64 = 7_000_000; // about 5 MB of image

function parseJson(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("no json");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    // Allow whatever headers the Supabase client sends (the list changes between versions).
    const asked = req.headers.get("Access-Control-Request-Headers");
    return new Response("ok", { headers: asked ? { ...CORS, "Access-Control-Allow-Headers": asked } : CORS });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "server_not_configured" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1. Who is calling?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: "not_signed_in" }, 401);

  // 2. Check the request
  let body: { image?: string; mediaType?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const image = String(body.image ?? "");
  const mediaType = String(body.mediaType ?? "image/jpeg");
  if (!image || image.length > MAX_BASE64 || !MEDIA_TYPES.includes(mediaType)) return json({ error: "bad_image" }, 400);

  // 3. Count the scan against the monthly limit (before spending money)
  const month = new Date().toISOString().slice(0, 7);
  const limit = Number(Deno.env.get("SCAN_LIMIT_PER_MONTH") ?? "50");
  const { data: used, error: useErr } = await admin.rpc("use_scan", { p_user: user.id, p_month: month, p_limit: limit });
  if (useErr) { console.error(useErr); return json({ error: "server_error" }, 500); }
  if (used < 0) return json({ error: "limit_reached", limit }, 429);

  const refund = () => admin.rpc("refund_scan", { p_user: user.id, p_month: month });

  // 4. Ask Claude to read the receipt
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    if (!res.ok) {
      console.error("anthropic", res.status, await res.text());
      await refund();
      return json({ error: res.status === 429 || res.status === 529 ? "busy" : "ai_error" }, 502);
    }
    const out = await res.json();
    const text = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    let receipt: Record<string, unknown>;
    try { receipt = parseJson(text) as Record<string, unknown>; } catch {
      await refund();
      return json({ error: "unreadable" }, 422);
    }
    if (receipt.error || !Array.isArray(receipt.items)) {
      await refund();
      return json({ error: "not_receipt" }, 422);
    }
    return json({ receipt, used, limit });
  } catch (e) {
    console.error(e);
    await refund();
    return json({ error: "server_error" }, 500);
  }
});
