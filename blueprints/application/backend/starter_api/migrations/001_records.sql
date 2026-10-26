CREATE TABLE records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
    details TEXT NOT NULL DEFAULT '' CHECK(length(details) <= 2000),
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
