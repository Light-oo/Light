type Row = Record<string, unknown>;
type QueryError = {
  code: string;
  message: string;
  details?: string;
  constraint?: string;
};

type QueryResult = {
  data: unknown;
  error: QueryError | null;
  count: number | null;
};

type EqFilter = {
  column: string;
  value: unknown;
};

type OrderSpec = {
  column: string;
  ascending: boolean;
};

type SeedTables = Record<string, Row[]>;

function cloneRow<T extends Row>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

function nowIso(offsetSeconds: number) {
  const base = new Date("2026-03-06T00:00:00.000Z").getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function parseSelectColumns(selectClause: string): string[] | null {
  const trimmed = selectClause.trim();
  if (trimmed === "*" || trimmed.length === 0) {
    return null;
  }

  const columns: string[] = [];
  for (const token of trimmed.split(",")) {
    const value = token.trim();
    if (value.length === 0) {
      continue;
    }
    if (value.includes("(") || value.includes(")")) {
      continue;
    }
    columns.push(value);
  }
  return columns;
}

function projectRows(rows: Row[], selectClause: string) {
  const columns = parseSelectColumns(selectClause);
  if (!columns) {
    return rows.map((row) => cloneRow(row));
  }

  return rows.map((row) => {
    const out: Row = {};
    for (const column of columns) {
      out[column] = row[column];
    }
    return out;
  });
}

function makeMissingColumnError(column: string): QueryError {
  return {
    code: "42703",
    message: `column "${column}" does not exist`
  };
}

export class InMemorySupabase {
  private tables = new Map<string, Row[]>();
  private schemas = new Map<string, Set<string>>();
  private clockSeconds = 0;
  private idCounter = 0;

  constructor(seed: SeedTables) {
    for (const [table, rows] of Object.entries(seed)) {
      const cloned = rows.map((row) => cloneRow(row));
      this.tables.set(table, cloned);
      const schema = new Set<string>();
      for (const row of cloned) {
        for (const column of Object.keys(row)) {
          schema.add(column);
        }
      }
      this.schemas.set(table, schema);
    }
  }

  from(table: string) {
    return new InMemoryQueryBuilder(this, table);
  }

  snapshot(table: string): Row[] {
    return (this.tables.get(table) ?? []).map((row) => cloneRow(row));
  }

  private ensureTable(table: string) {
    if (!this.tables.has(table)) {
      this.tables.set(table, []);
      this.schemas.set(table, new Set<string>());
    }
  }

  private hasColumn(table: string, column: string) {
    const schema = this.schemas.get(table);
    if (!schema) {
      return false;
    }
    if (schema.size === 0) {
      return true;
    }
    return schema.has(column);
  }

  private registerColumns(table: string, row: Row) {
    this.ensureTable(table);
    const schema = this.schemas.get(table)!;
    for (const key of Object.keys(row)) {
      schema.add(key);
    }
  }

  private nextTimestamp() {
    this.clockSeconds += 1;
    return nowIso(this.clockSeconds);
  }

  private nextId(table: string) {
    this.idCounter += 1;
    return `${table}-id-${this.idCounter}`;
  }

  private applyFilters(table: string, rows: Row[], filters: EqFilter[]): QueryResult | { rows: Row[] } {
    let filtered = [...rows];
    for (const filter of filters) {
      if (!this.hasColumn(table, filter.column)) {
        return {
          data: null,
          error: makeMissingColumnError(filter.column),
          count: null
        };
      }
      filtered = filtered.filter((row) => row[filter.column] === filter.value);
    }
    return { rows: filtered };
  }

  select(params: {
    table: string;
    selectClause: string;
    countExact: boolean;
    filters: EqFilter[];
    orderSpec: OrderSpec | null;
    rangeSpec: { from: number; to: number } | null;
    limitValue: number | null;
  }): QueryResult {
    const rows = this.tables.get(params.table);
    if (!rows) {
      return {
        data: null,
        error: {
          code: "42P01",
          message: `relation "${params.table}" does not exist`
        },
        count: null
      };
    }

    const filteredResult = this.applyFilters(params.table, rows, params.filters);
    if ("error" in filteredResult) {
      return filteredResult;
    }

    let filteredRows = [...filteredResult.rows];
    const total = filteredRows.length;

    if (params.orderSpec) {
      const { column, ascending } = params.orderSpec;
      if (!this.hasColumn(params.table, column)) {
        return {
          data: null,
          error: makeMissingColumnError(column),
          count: null
        };
      }

      filteredRows.sort((left, right) => {
        const a = left[column];
        const b = right[column];
        if (a === b) {
          return 0;
        }
        if (typeof a === "number" && typeof b === "number") {
          return ascending ? a - b : b - a;
        }
        const aText = String(a ?? "");
        const bText = String(b ?? "");
        return ascending ? aText.localeCompare(bText) : bText.localeCompare(aText);
      });
    }

    if (params.rangeSpec) {
      filteredRows = filteredRows.slice(params.rangeSpec.from, params.rangeSpec.to + 1);
    } else if (params.limitValue !== null) {
      filteredRows = filteredRows.slice(0, params.limitValue);
    }

    return {
      data: projectRows(filteredRows, params.selectClause),
      error: null,
      count: params.countExact ? total : null
    };
  }

  update(params: {
    table: string;
    patch: Row;
    filters: EqFilter[];
  }): QueryResult {
    const rows = this.tables.get(params.table);
    if (!rows) {
      return {
        data: null,
        error: {
          code: "42P01",
          message: `relation "${params.table}" does not exist`
        },
        count: null
      };
    }

    const filteredResult = this.applyFilters(params.table, rows, params.filters);
    if ("error" in filteredResult) {
      return filteredResult;
    }

    for (const row of rows) {
      const matches = params.filters.every((filter) => row[filter.column] === filter.value);
      if (!matches) {
        continue;
      }
      for (const [key, value] of Object.entries(params.patch)) {
        row[key] = value;
      }
      this.registerColumns(params.table, params.patch);
    }

    return {
      data: null,
      error: null,
      count: filteredResult.rows.length
    };
  }

  insert(table: string, payload: Row | Row[]): QueryResult {
    this.ensureTable(table);
    const rows = this.tables.get(table)!;
    const inserts = asArray(payload).map((row) => cloneRow(row));

    for (const insert of inserts) {
      if (!insert.id && (table === "demands" || table === "listings")) {
        insert.id = this.nextId(table);
      }
      if (!insert.created_at) {
        insert.created_at = this.nextTimestamp();
      }

      if (table === "listings") {
        const duplicate = rows.some((existing) => {
          const sameSeller = existing.seller_profile_id === insert.seller_profile_id;
          const sameType = existing.listing_type === "sell" && insert.listing_type === "sell";
          const sameStatus = existing.status === "active" && insert.status === "active";
          const sameSignature = existing.intention_signature === insert.intention_signature;
          const sameMarket =
            (existing.market_key ?? null) === (insert.market_key ?? null) &&
            (existing.market_id ?? null) === (insert.market_id ?? null);
          return sameSeller && sameType && sameStatus && sameSignature && sameMarket;
        });

        if (duplicate) {
          return {
            data: null,
            error: {
              code: "23505",
              message: "duplicate key value violates unique constraint",
              constraint: "listings_s1_active_sell_uq"
            },
            count: null
          };
        }
      }

      if (table === "demands") {
        const duplicate = rows.some((existing) => {
          const sameRequester = existing.requester_user_id === insert.requester_user_id;
          const sameStatus = existing.status === "open" && insert.status === "open";
          const sameSignature = existing.intention_signature === insert.intention_signature;
          const sameMarket =
            (existing.market_key ?? null) === (insert.market_key ?? null) &&
            (existing.market_id ?? null) === (insert.market_id ?? null);
          return sameRequester && sameStatus && sameSignature && sameMarket;
        });

        if (duplicate) {
          return {
            data: null,
            error: {
              code: "23505",
              message: "duplicate key value violates unique constraint",
              constraint: "demands_open_unique_signature"
            },
            count: null
          };
        }
      }

      rows.push(insert);
      this.registerColumns(table, insert);
    }

    return {
      data: null,
      error: null,
      count: null
    };
  }
}

class InMemoryQueryBuilder implements PromiseLike<QueryResult> {
  private action: "select" | "update" = "select";
  private selectClause = "*";
  private countExact = false;
  private filters: EqFilter[] = [];
  private orderSpec: OrderSpec | null = null;
  private rangeSpec: { from: number; to: number } | null = null;
  private limitValue: number | null = null;
  private updatePatch: Row | null = null;

  constructor(
    private readonly supabase: InMemorySupabase,
    private readonly table: string
  ) {}

  select(selectClause = "*", options?: { count?: "exact" | "planned" | "estimated" }) {
    this.action = "select";
    this.selectClause = selectClause;
    this.countExact = options?.count === "exact";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderSpec = {
      column,
      ascending: options?.ascending !== false
    };
    return this;
  }

  range(from: number, to: number) {
    this.rangeSpec = { from, to };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  update(patch: Row) {
    this.action = "update";
    this.updatePatch = patch;
    return this;
  }

  insert(payload: Row | Row[]) {
    return Promise.resolve(this.supabase.insert(this.table, payload));
  }

  async maybeSingle() {
    const result = await this.execute();
    if (result.error) {
      return { data: null, error: result.error };
    }
    const rows = (result.data as Row[]) ?? [];
    if (rows.length === 0) {
      return { data: null, error: null };
    }
    if (rows.length > 1) {
      return {
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, multiple rows returned"
        } as QueryError
      };
    }
    return { data: cloneRow(rows[0]), error: null };
  }

  async single() {
    const result = await this.execute();
    if (result.error) {
      return { data: null, error: result.error };
    }
    const rows = (result.data as Row[]) ?? [];
    if (rows.length !== 1) {
      return {
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, one row required"
        } as QueryError
      };
    }
    return { data: cloneRow(rows[0]), error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute() {
    if (this.action === "update") {
      return Promise.resolve(
        this.supabase.update({
          table: this.table,
          patch: this.updatePatch ?? {},
          filters: this.filters
        })
      );
    }

    return Promise.resolve(
      this.supabase.select({
        table: this.table,
        selectClause: this.selectClause,
        countExact: this.countExact,
        filters: this.filters,
        orderSpec: this.orderSpec,
        rangeSpec: this.rangeSpec,
        limitValue: this.limitValue
      })
    );
  }
}

export type InMemorySupabaseLike = InMemorySupabase;
