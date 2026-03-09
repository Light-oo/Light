import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";

const router = Router();

const idParamSchema = z.object({
  id: z.string().uuid()
});

const patchMeBodySchema = z.object({
  department_id: z.number().int().positive().nullable()
}).strict();

router.get("/api/me", requireAuth, (req, res) => {
  const user = (req as unknown as { user: { id: string } }).user;
  res.json({ ok: true, userId: user.id });
});

router.patch("/api/me", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof patchMeBodySchema>;
  try {
    parsed = patchMeBodySchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data, error } = await supabase
    .from("profiles")
    .update({ department_id: parsed.department_id })
    .eq("id", userId)
    .select("id,department_id")
    .maybeSingle();

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!data) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  return res.json({
    ok: true,
    data: {
      department_id: (data as any).department_id ?? null
    }
  });
});

router.get("/api/me/buy-demands", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const userId = (req as unknown as { user: { id: string } }).user.id;

  const { data, error } = await supabase
    .from("demands")
    .select("*")
    .eq("requester_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  return res.json({ ok: true, data: data ?? [] });
});

router.delete("/api/me/buy-demands/:id", requireAuth, async (req, res, next) => {
  let id: string;
  try {
    ({ id } = idParamSchema.parse(req.params));
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const userId = (req as unknown as { user: { id: string } }).user.id;

  const { data, error } = await supabase
    .from("demands")
    .delete()
    .eq("id", id)
    .eq("requester_user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!data) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  return res.json({ ok: true });
});

export default router;
