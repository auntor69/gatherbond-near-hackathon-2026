// Single-use nonce store for NEP-413 logins.
//
// The table is created lazily with IF NOT EXISTS so adding sessions needs no change to the
// existing Turso migration command (`0001_event_metadata.sql`). The nonce is scoped by
// account so one account's login can never consume another account's nonce.
//
// claim() returns true only for the first insert; a replay returns false.

const DDL = `
CREATE TABLE IF NOT EXISTS auth_nonces (
  account_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, nonce)
)
`;

export function createSqliteNonceStore(db) {
  db.exec(DDL);
  return {
    async claim(accountId, nonce) {
      const result = db
        .prepare("INSERT OR IGNORE INTO auth_nonces (account_id, nonce, used_at) VALUES (?, ?, ?)")
        .run(accountId, nonce, Date.now());
      return Number(result.changes ?? 0) === 1;
    },
  };
}

export function createLibsqlNonceStore(client) {
  let ready = null;
  const ensureSchema = () => {
    ready ??= Promise.resolve(client.executeMultiple(DDL));
    return ready;
  };

  return {
    async claim(accountId, nonce) {
      await ensureSchema();
      const result = await client.execute({
        sql: "INSERT OR IGNORE INTO auth_nonces (account_id, nonce, used_at) VALUES (?, ?, ?)",
        args: [accountId, nonce, Date.now()],
      });
      return Number(result.rowsAffected ?? 0) === 1;
    },
  };
}

/** Build the nonce store for a store selection; null means auth cannot be used. */
export function nonceStoreForSelection(selection) {
  if (selection?.mode === "sqlite" && selection.db) {
    return createSqliteNonceStore(selection.db);
  }
  if (selection?.mode === "turso" && selection.client) {
    return createLibsqlNonceStore(selection.client);
  }
  return null;
}
