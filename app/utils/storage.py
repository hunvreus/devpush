import sqlite3
import time


WRITE_KEYWORDS = {
    "insert",
    "update",
    "delete",
    "replace",
    "create",
    "drop",
    "alter",
    "truncate",
    "vacuum",
    "reindex",
    "pragma",
}


def is_write_query(sql: str) -> bool:
    statement = sql.strip()
    while statement.startswith("--") or statement.startswith("/*"):
        if statement.startswith("--"):
            newline = statement.find("\n")
            statement = "" if newline == -1 else statement[newline + 1 :].lstrip()
            continue
        end = statement.find("*/")
        statement = "" if end == -1 else statement[end + 2 :].lstrip()
    if not statement:
        return False
    token = statement.split(None, 1)[0].lower()
    return token in WRITE_KEYWORDS


def _nocase_collation(a, b):
    return (a.lower() > b.lower()) - (a.lower() < b.lower())


def open_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.create_collation("NOCASE_UTF8", _nocase_collation)
    conn.create_collation("LIKE", _nocase_collation)
    return conn


def get_tables(path: str) -> tuple[list[str], dict]:
    conn = open_db(path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cursor.fetchall() if not row[0].startswith("sqlite_")]
    schemas = {}
    for table in tables:
        cursor.execute(f"PRAGMA table_info([{table}])")
        schemas[table] = [
            {"name": row[1], "type": row[2], "notnull": row[3], "pk": row[5]}
            for row in cursor.fetchall()
        ]
    conn.close()
    return tables, schemas


def get_table_structure(path: str, table: str) -> dict:
    conn = open_db(path)
    cursor = conn.cursor()

    cursor.execute(f"PRAGMA table_info([{table}])")
    columns = [
        {"name": row[1], "type": row[2], "notnull": row[3], "pk": row[5]}
        for row in cursor.fetchall()
    ]

    cursor.execute(f"PRAGMA index_list([{table}])")
    indexes = []
    for row in cursor.fetchall():
        index_name = row[1]
        is_unique = bool(row[2])
        cursor.execute(f"PRAGMA index_info([{index_name}])")
        index_columns = [col[2] for col in cursor.fetchall()]
        indexes.append(
            {"name": index_name, "unique": is_unique, "columns": index_columns}
        )

    cursor.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    )
    ddl_row = cursor.fetchone()
    ddl = ddl_row[0] if ddl_row else None
    if ddl:
        lines = [line.strip() for line in ddl.splitlines() if line.strip()]
        if len(lines) >= 2:
            ddl = "\n".join([lines[0], *[f"  {line}" for line in lines[1:-1]], lines[-1]])
        else:
            ddl = lines[0] if lines else ddl

    conn.close()
    return {"columns": columns, "indexes": indexes, "ddl": ddl}


def read_table(path: str, table: str, page: int = 1, per_page: int = 50) -> dict:
    conn = open_db(path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA query_only = ON")

    cursor.execute(f"SELECT COUNT(*) FROM [{table}]")
    total = cursor.fetchone()[0]

    offset = (page - 1) * per_page
    start = time.time()
    cursor.execute(f"SELECT * FROM [{table}] LIMIT {per_page} OFFSET {offset}")
    rows = [dict(row) for row in cursor.fetchall()]
    elapsed = time.time() - start

    if rows:
        columns = list(rows[0].keys())
    else:
        cursor.execute(f"PRAGMA table_info([{table}])")
        columns = [row[1] for row in cursor.fetchall()]
    conn.close()

    return {
        "columns": columns,
        "rows": rows,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
        "time": elapsed,
    }


def execute_query(path: str, sql: str, write_mode: bool = False) -> dict:
    conn = open_db(path)
    cursor = conn.cursor()

    if not write_mode:
        cursor.execute("PRAGMA query_only = ON")

    start = time.time()
    cursor.execute(sql)
    elapsed = time.time() - start

    if cursor.description:
        columns = [desc[0] for desc in cursor.description]
        rows = [dict(row) for row in cursor.fetchmany(1000)]
    else:
        columns = []
        rows = []

    affected = cursor.rowcount if not cursor.description else 0

    if write_mode:
        conn.commit()

    conn.close()

    return {
        "columns": columns,
        "rows": rows,
        "total": len(rows),
        "time": elapsed,
        "affected": affected,
    }
