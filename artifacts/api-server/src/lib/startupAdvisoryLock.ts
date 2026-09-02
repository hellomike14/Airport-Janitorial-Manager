export const STARTUP_ADVISORY_LOCK_NAME =
  "airport-janitorial-manager:startup-migrations:v1";

export interface AdvisoryLockClient {
  query(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows?: Array<Record<string, unknown>> }>;
  release(destroy?: boolean | Error): void;
}

export interface AdvisoryLockPool<Client extends AdvisoryLockClient> {
  connect(): Promise<Client>;
}

const ACQUIRE_LOCK_SQL =
  "SELECT pg_advisory_lock(hashtextextended($1::text, 0))";
const RELEASE_LOCK_SQL =
  "SELECT pg_advisory_unlock(hashtextextended($1::text, 0)) AS unlocked";

/**
 * Run startup work while a PostgreSQL session-level advisory lock is held.
 *
 * The checked-out client must remain checked out for the entire callback:
 * session-level advisory locks belong to a physical PostgreSQL connection,
 * not to a pool or transaction. A failed unlock destroys that connection so
 * a lock can never leak back into the pool.
 */
export async function withPostgresAdvisoryLock<
  Client extends AdvisoryLockClient,
  Result,
>(
  pool: AdvisoryLockPool<Client>,
  lockName: string,
  work: (lockClient: Client) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  let acquired = false;
  let destroyConnection = false;
  let hasFailure = false;
  let failure: unknown;
  let result: Result | undefined;

  try {
    try {
      await client.query(ACQUIRE_LOCK_SQL, [lockName]);
      acquired = true;
      result = await work(client);
    } catch (error) {
      hasFailure = true;
      failure = error;
      // A failed lock query can indicate a broken connection. Do not return
      // that physical connection to the pool without destroying it.
      if (!acquired) destroyConnection = true;
    }

    if (acquired) {
      try {
        const unlockResult = await client.query(RELEASE_LOCK_SQL, [lockName]);
        if (unlockResult.rows?.[0]?.["unlocked"] !== true) {
          throw new Error(
            `PostgreSQL did not release startup advisory lock "${lockName}"`,
          );
        }
      } catch (unlockError) {
        destroyConnection = true;
        if (hasFailure) {
          failure = new AggregateError(
            [failure, unlockError],
            `Startup failed and advisory lock "${lockName}" could not be released`,
          );
        } else {
          hasFailure = true;
          failure = unlockError;
        }
      }
    }
  } finally {
    client.release(destroyConnection);
  }

  if (hasFailure) throw failure;
  return result as Result;
}
