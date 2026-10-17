import { deleteAccount } from '../_shared/accounts.ts';
import { serveWith } from '../_shared/serve.ts';
serveWith((_body, deps) => deleteAccount(deps));
