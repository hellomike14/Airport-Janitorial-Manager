export class AuthServiceUnavailable extends Error {
  constructor() { super("Sign-in service temporarily unavailable"); }
}

/** Bound dependency waits and never translate an outage into an account rejection. */
export async function withAuthDeadline<T>(operation: Promise<T>, milliseconds = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AuthServiceUnavailable()), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
