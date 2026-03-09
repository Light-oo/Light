import { Router } from "express";
import { createSupabaseServiceRole } from "../lib/supabase";

const router = Router();

type LandingRecentDemandRpcRow = {
  demand_id: string;
  brand: string | null;
  model: string | null;
  year: number | string | null;
  item_type: string | null;
  part: string | null;
  created_at: string;
};

router.get("/landing/latest-demands", async (_req, res) => {
  try {
    const supabase = createSupabaseServiceRole();
    const { data, error } = await supabase.rpc("get_landing_recent_demands");

    if (error) {
      console.error("landing_latest_demands_rpc_error", {
        code: error.code,
        message: error.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const rows = (data ?? []) as LandingRecentDemandRpcRow[];
    return res.json(
      rows.map((row) => ({
        id: row.demand_id,
        intent: "Busco",
        brand: row.brand ?? null,
        model: row.model ?? null,
        year: row.year ?? null,
        item_type: row.item_type ?? null,
        part: row.part ?? null,
        location: "El Salvador",
        price: null,
        created_at: row.created_at
      }))
    );
  } catch (error: any) {
    console.error("landing_latest_demands_error", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      stack: error?.stack
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;

