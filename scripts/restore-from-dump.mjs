// One-off restore script: loads data from a pg_dump plain-SQL backup into a database
// whose schema is (re)created via `prisma migrate deploy`, rather than replaying the
// dump's raw DDL. Usage:
//   DATABASE_URL="postgresql://..." node scripts/restore-from-dump.mjs <path-to-dump.sql>
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error("Usage: node scripts/restore-from-dump.mjs <path-to-dump.sql>");
  process.exit(1);
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const TABLE_ORDER = ["users", "projects", "phase_steps", "procurement_items", "step_status_log"];

function unescapeCopyField(raw) {
  if (raw === "\\N") return null;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === "t") { out += "\t"; i++; continue; }
      if (next === "n") { out += "\n"; i++; continue; }
      if (next === "r") { out += "\r"; i++; continue; }
      if (next === "\\") { out += "\\"; i++; continue; }
      out += next;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  return "'" + value.replace(/'/g, "''") + "'";
}

function parseCopyBlocks(sqlText) {
  const lines = sqlText.split("\n");
  const blocks = {};
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^COPY public\.(\w+) \(([^)]+)\) FROM stdin;$/);
    if (m) {
      const table = m[1];
      const columns = m[2].split(",").map((c) => c.trim());
      const rows = [];
      i++;
      while (i < lines.length && lines[i] !== "\\.") {
        if (lines[i].length > 0) {
          rows.push(lines[i].split("\t").map(unescapeCopyField));
        }
        i++;
      }
      blocks[table] = { columns, rows };
    }
    i++;
  }
  return blocks;
}

async function main() {
  const sqlText = fs.readFileSync(path.resolve(dumpPath), "utf8");
  const blocks = parseCopyBlocks(sqlText);

  const client = new Client({ connectionString });
  await client.connect();
  console.log("Connected.");

  try {
    for (const table of TABLE_ORDER) {
      const block = blocks[table];
      if (!block || block.rows.length === 0) {
        console.log(`  ${table}: no rows in dump, skipping`);
        continue;
      }
      const { columns, rows } = block;
      const colList = columns.map((c) => `"${c}"`).join(", ");
      const valuesSql = rows
        .map((row) => "(" + row.map(sqlLiteral).join(", ") + ")")
        .join(",\n");
      const insertSql = `INSERT INTO public.${table} (${colList}) VALUES\n${valuesSql};`;
      await client.query(insertSql);
      console.log(`  ${table}: inserted ${rows.length} rows`);
    }
  } finally {
    await client.end();
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
