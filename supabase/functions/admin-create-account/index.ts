import { createAccount } from '../_shared/accounts.ts';
import { serveWith } from '../_shared/serve.ts';
serveWith((body, deps) => createAccount(body, deps));
