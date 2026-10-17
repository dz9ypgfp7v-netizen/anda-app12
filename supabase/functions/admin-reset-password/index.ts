import { resetPassword } from '../_shared/accounts.ts';
import { serveWith } from '../_shared/serve.ts';
serveWith((body, deps) => resetPassword(body, deps));
