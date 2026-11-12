import clients from '../clients.json';

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Input is a SHA-256 base64url digest, matching the pinned provider's defaultHasher. */
export function clientSeedSQL(cloudSecretHash: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(cloudSecretHash)) throw new Error('Cloud secret hash required');
  return clients.map(client => {
    const fields = {
      id: `seed:${client.clientId}`,
      ...client,
      skipConsent: client.skipConsent &&
        ['automagik-desktop', 'automagik-cloud'].includes(client.clientId),
      clientSecret: client.clientId === 'automagik-cloud' ? cloudSecretHash : null,
      requirePKCE: true,
      enableEndSession: true,
      scopes: ['openid', 'profile', 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
    };
    const keys = Object.keys(fields);
    const values = Object.values(fields).map(value => value === null ? 'NULL' :
      typeof value === 'boolean' ? String(Number(value)) :
      sqlString(Array.isArray(value) ? JSON.stringify(value) : value));
    return `INSERT INTO "oauthClient" (${keys.map(key => `"${key}"`).join(', ')}) ` +
      `VALUES (${values.join(', ')}) ON CONFLICT("clientId") DO UPDATE SET ` +
      keys.filter(key => key !== 'id' && key !== 'clientId')
        .map(key => `"${key}" = excluded."${key}"`).join(', ') + ';';
  }).join('\n');
}
