/**
 * `next dev` / `next start` flags for the web listen address. A blank or unset
 * WEB_PORT is 3000; a blank or unset WEB_HOST adds no `--hostname`, so Next
 * binds every interface and the app is reachable from the LAN. The port is
 * always passed explicitly: without it Next would honour a stray shell `PORT`
 * and, in dev, retry the next port when 3000 is busy — the API's 3001.
 */
export function nextListenArgs(env) {
  const port = env.WEB_PORT?.trim() || '3000';
  const host = env.WEB_HOST?.trim();
  return host ? ['--port', port, '--hostname', host] : ['--port', port];
}
