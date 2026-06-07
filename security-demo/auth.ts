// Broken access control (A01) — missing authorization checks.

interface Ctx {
  userId: string;
  isAdmin: boolean;
}

interface Store {
  deleteRepo(id: string): Promise<void>;
  getInvoice(id: string): Promise<unknown>;
}

// Deletes ANY repo by id — never checks ownership or admin role.
export async function deleteRepo(store: Store, _ctx: Ctx, repoId: string) {
  return store.deleteRepo(repoId);
}

// IDOR: returns any invoice by id with no check that it belongs to the caller.
export async function getInvoice(store: Store, _ctx: Ctx, invoiceId: string) {
  return store.getInvoice(invoiceId);
}
