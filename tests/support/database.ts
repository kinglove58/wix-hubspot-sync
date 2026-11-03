import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

type Result = { data: Record<string, unknown> | Record<string, unknown>[] | unknown; error: { code?: string; message: string } | null };
const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Invalid test SQL identifier");
  return `"${value}"`;
};

/** Development-only PostgREST query adapter. Production repositories and SQL
 * functions execute unchanged against real PostgreSQL; only HTTP transport is replaced. */
export class TestDatabase {
  constructor(readonly pg: PGlite) {}
  from(table: string) { return new Query(this.pg, table); }
  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    try {
      const entries = Object.entries(args);
      const result = await this.pg.query<{ value: unknown }>(`select public.${identifier(name)}(${entries.map(([key], i) => `${identifier(key)} => $${i + 1}`).join(",")}) as value`, entries.map(([, value]) => value && typeof value === "object" ? JSON.stringify(value) : value));
      return { data: result.rows[0]?.value ?? null, error: null };
    } catch (error) { return failure(error); }
  }
}
function failure(error: unknown): Result {
  return { data: null, error: { code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined, message: "Test database query failed" } };
}

class Query implements PromiseLike<Result> {
  private columns = "*";
  private mode = "select";
  private values: Record<string, unknown>[] = [];
  private conflict = "";
  private ignore = false;
  private filters: Array<{ sql: string; values: unknown[] }> = [];
  private ordering = "";
  private maximum: number | undefined;
  private returning = false;
  constructor(private pg: PGlite, private table: string) {}
  select(columns = "*") { this.columns = columns; this.returning = true; return this; }
  insert(value: Record<string, unknown> | Record<string, unknown>[]) { this.mode = "insert"; this.values = Array.isArray(value) ? value : [value]; return this; }
  upsert(value: Record<string, unknown> | Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates?: boolean }) {
    this.insert(value); this.conflict = options.onConflict; this.ignore = options.ignoreDuplicates ?? false; return this;
  }
  update(value: Record<string, unknown>) { this.mode = "update"; this.values = [value]; return this; }
  delete() { this.mode = "delete"; return this; }
  eq(column: string, value: unknown) { this.filters.push({ sql: `${identifier(column)} = ?`, values: [value] }); return this; }
  gt(column: string, value: unknown) { this.filters.push({ sql: `${identifier(column)} > ?`, values: [value] }); return this; }
  lt(column: string, value: unknown) { this.filters.push({ sql: `${identifier(column)} < ?`, values: [value] }); return this; }
  is(column: string, value: null) { void value; this.filters.push({ sql: `${identifier(column)} is null`, values: [] }); return this; }
  not(column: string, operator: string, value: null) { void value; if (operator !== "is") throw new Error("Unsupported test filter"); this.filters.push({ sql: `${identifier(column)} is not null`, values: [] }); return this; }
  in(column: string, values: unknown[]) { this.filters.push({ sql: values.length ? `${identifier(column)} in (${values.map(() => "?").join(",")})` : "false", values }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.ordering = ` order by ${identifier(column)} ${options?.ascending === false ? "desc" : "asc"}`; return this; }
  limit(count: number) { this.maximum = count; return this; }
  async maybeSingle() { return this.execute(true, false); }
  async single() { return this.execute(true, true); }
  then<T = Result, U = never>(resolve?: ((value: Result) => T | PromiseLike<T>) | null, reject?: ((reason: unknown) => U | PromiseLike<U>) | null): PromiseLike<T | U> {
    return this.execute().then(resolve, reject);
  }
  private async execute(single = false, required = false): Promise<Result> {
    try {
      const bindings: unknown[] = [];
      const bind = (value: unknown) => { bindings.push(Array.isArray(value) ? `{${value.map((entry) => JSON.stringify(entry)).join(",")}}` : value && typeof value === "object" ? JSON.stringify(value) : value); return `$${bindings.length}`; };
      const projection = this.columns === "*" ? "*" : this.columns.split(",").map(identifier).join(",");
      const table = `public.${identifier(this.table)}`;
      let sql: string;
      if (this.mode === "insert") {
        const keys = Object.keys(this.values[0]);
        sql = `insert into ${table}(${keys.map(identifier).join(",")}) values ${this.values.map((row) => `(${keys.map((key) => bind(row[key])).join(",")})`).join(",")}`;
        if (this.conflict) sql += ` on conflict (${this.conflict.split(",").map(identifier).join(",")}) ${this.ignore ? "do nothing" : `do update set ${keys.map((key) => `${identifier(key)}=excluded.${identifier(key)}`).join(",")}`}`;
      } else if (this.mode === "update") sql = `update ${table} set ${Object.entries(this.values[0]).map(([key, value]) => `${identifier(key)}=${bind(value)}`).join(",")}`;
      else if (this.mode === "delete") sql = `delete from ${table}`;
      else sql = `select ${projection} from ${table}`;
      if (this.filters.length) sql += ` where ${this.filters.map((filter) => { let i = 0; return filter.sql.replace(/\?/g, () => bind(filter.values[i++])); }).join(" and ")}`;
      if (this.mode === "select") sql += this.ordering + (this.maximum !== undefined ? ` limit ${Number(this.maximum)}` : "");
      else if (this.returning) sql += ` returning ${projection}`;
      const result = await this.pg.query<Record<string, unknown>>(sql, bindings);
      if (single && (result.rows.length > 1 || required && result.rows.length !== 1)) return { data: null, error: { code: "PGRST116", message: "Unexpected row count" } };
      return { data: single ? result.rows[0] ?? null : result.rows, error: null };
    } catch (error) { return failure(error); }
  }
}

export async function migratedTestDatabase(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const name of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) await pg.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  return pg;
}
