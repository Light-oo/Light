type DemandSearchFilters = {
  brandId?: string;
  modelId?: string;
  yearId?: string;
  itemTypeId?: string;
  partId?: string;
};

type SearchOpenDemandsParams = {
  supabase: any;
  filters: DemandSearchFilters;
  page: number;
  pageSize: number;
};

export async function searchOpenDemands({
  supabase,
  filters,
  page,
  pageSize
}: SearchOpenDemandsParams) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("demands")
    .select(
      "id,requester_user_id,status,brand_id,model_id,year_id,item_type_id,part_id,details_text,created_at",
      { count: "exact" }
    )
    .eq("status", "open");

  if (filters.brandId) {
    query = query.eq("brand_id", filters.brandId);
  }
  if (filters.modelId) {
    query = query.eq("model_id", filters.modelId);
  }
  if (filters.yearId) {
    query = query.eq("year_id", filters.yearId);
  }
  if (filters.itemTypeId) {
    query = query.eq("item_type_id", filters.itemTypeId);
  }
  if (filters.partId) {
    query = query.eq("part_id", filters.partId);
  }

  return query.order("created_at", { ascending: false }).range(from, to);
}
