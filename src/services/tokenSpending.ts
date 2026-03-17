import { createSupabaseAnon } from "../lib/supabase";

type SupabaseClient = ReturnType<typeof createSupabaseAnon>;

export type TokenSpendSource = "paid" | "free";

export class TokenSpendError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function toFiniteInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }
  return 0;
}

async function loadTokenBalances(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,tokens,free_tokens")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new TokenSpendError(
      "token_balance_lookup_failed",
      `Failed reading token balances: ${error.message}`,
      500
    );
  }

  if (!data) {
    throw new TokenSpendError("profile_not_found", "Profile not found.", 404);
  }

  return {
    tokens: toFiniteInteger((data as Record<string, unknown>).tokens),
    freeTokens: toFiniteInteger((data as Record<string, unknown>).free_tokens)
  };
}

async function attemptSpendFromPaid(
  supabase: SupabaseClient,
  userId: string,
  currentPaidTokens: number
) {
  const { data, error } = await supabase
    .from("profiles")
    .update({ tokens: currentPaidTokens - 1 })
    .eq("id", userId)
    .eq("tokens", currentPaidTokens)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new TokenSpendError(
      "token_spend_failed",
      `Failed spending paid token: ${error.message}`,
      500
    );
  }

  return Boolean(data);
}

async function attemptSpendFromFree(
  supabase: SupabaseClient,
  userId: string,
  currentPaidTokens: number,
  currentFreeTokens: number
) {
  const { data, error } = await supabase
    .from("profiles")
    .update({ free_tokens: currentFreeTokens - 1 })
    .eq("id", userId)
    .eq("tokens", currentPaidTokens)
    .eq("free_tokens", currentFreeTokens)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new TokenSpendError(
      "token_spend_failed",
      `Failed spending free token: ${error.message}`,
      500
    );
  }

  return Boolean(data);
}

export async function consumeSingleTokenPreferringPaid(params: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const { supabase, userId } = params;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const balances = await loadTokenBalances(supabase, userId);

    if (balances.tokens > 0) {
      const spent = await attemptSpendFromPaid(supabase, userId, balances.tokens);
      if (spent) {
        return { source: "paid" as const };
      }
      continue;
    }

    if (balances.freeTokens > 0) {
      const spent = await attemptSpendFromFree(
        supabase,
        userId,
        balances.tokens,
        balances.freeTokens
      );
      if (spent) {
        return { source: "free" as const };
      }
      continue;
    }

    throw new TokenSpendError("insufficient_tokens", "No available tokens.", 402);
  }

  throw new TokenSpendError(
    "token_spend_conflict",
    "Token spend could not be completed after multiple retries.",
    409
  );
}

async function attemptRefund(
  supabase: SupabaseClient,
  userId: string,
  source: TokenSpendSource
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const balances = await loadTokenBalances(supabase, userId);

    const patch =
      source === "paid"
        ? { tokens: balances.tokens + 1 }
        : { free_tokens: balances.freeTokens + 1 };

    let query = supabase.from("profiles").update(patch).eq("id", userId);
    query = query.eq("tokens", balances.tokens);
    query = query.eq("free_tokens", balances.freeTokens);

    const { data, error } = await query.select("id").maybeSingle();

    if (error) {
      throw new TokenSpendError(
        "token_refund_failed",
        `Failed refunding token: ${error.message}`,
        500
      );
    }

    if (data) {
      return;
    }
  }

  throw new TokenSpendError(
    "token_refund_conflict",
    "Token refund could not be completed after multiple retries.",
    409
  );
}

export async function refundConsumedToken(params: {
  supabase: SupabaseClient;
  userId: string;
  source: TokenSpendSource;
}) {
  await attemptRefund(params.supabase, params.userId, params.source);
}
