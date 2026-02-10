import { Router } from "express";
import { z } from "zod";
import { createSupabaseAnon } from "../lib/supabase";

const router = Router();
const supabase = createSupabaseAnon();

const partsQuerySchema = z.object({
  itemTypeId: z.string().uuid()
});

router.get("/catalog/parts", async (req, res, next) => {
  let itemTypeId: string;
  try {
    ({ itemTypeId } = partsQuerySchema.parse(req.query));
  } catch (err) {
    return next(err);
  }

  const { data, error } = await supabase.rpc("get_part_options", {
    item_type_id: itemTypeId
  });

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (data && data.length > 0) {
    const requiredColumns = ["part_id", "label_es", "sort_order"];
    const missing = requiredColumns.filter((col) => !(col in data[0]));
    if (missing.length > 0) {
      console.error("missing_columns", { missing });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }
  }

  const sorted = [...(data ?? [])].sort((a, b) => {
    const aSort = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bSort = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (aSort !== bSort) {
      return aSort - bSort;
    }
    return String(a.label_es).localeCompare(String(b.label_es), "es");
  });

  return res.json({
    ok: true,
    data: {
      itemTypeId,
      options: sorted.map((row) => ({
        id: row.part_id,
        label: row.label_es,
        sortOrder: row.sort_order
      }))
    }
  });
});

export default router;
