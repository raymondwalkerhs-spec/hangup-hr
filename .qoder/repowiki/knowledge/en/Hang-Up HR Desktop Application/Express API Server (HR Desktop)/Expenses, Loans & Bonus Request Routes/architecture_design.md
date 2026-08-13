Three sibling Express Router modules (`expenses.js`, `loan-requests.js`, `bonus-requests.js`) mounted as sub-routes. Each router is a thin HTTP layer that:
- Enforces authorization inline via `../lib/roles` checks (e.g. `canSubmitExpense`, `canApproveLoanRequest`, `canAccessEmployee`) before delegating.
- Persists data through domain-specific repos — `business-repo` for expenses/bonuses and `loan-requests-repo` for loans — plus `data-store` for cross-cutting reads like employees.
- Emits notifications through `notify-store` / `notify-dispatch` after state transitions (approve/deny/create), addressing the submitter or executive approvers.
- Triggers side effects post-mutation: `afterExpenseMutation()` refreshes the business cache; approvals write into `store.upsertBonus` / `store.createEmployeeLoan` to keep the payroll ledger in sync.
- Exposes file upload/download for receipts via `../lib/storage` (`uploadBuffer`, `getStorageFileStream`).

Dependency direction is strictly inward: routes → lib/* (roles, repos, store, notify, storage). There is no shared base controller — each route file owns its own local helpers (e.g. `requireFinance`, `filterRequestsForUser`, `shouldAuditExpense`) and returns uniform `{ ok, ... }` JSON responses with consistent error shapes.