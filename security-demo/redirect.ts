// Open redirect (A01) — user-controlled redirect target, no allow-list.

interface Res {
  redirect(url: string): void;
}

// `next` comes straight from the query string: ?next=https://evil.example.com
export function loginRedirect(res: Res, next: string) {
  res.redirect(next);
}
