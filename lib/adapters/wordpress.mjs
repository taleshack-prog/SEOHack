// ADAPTER: WordPress — instalação zero de verdade.
//
// A maior parte dos clientes pagantes não está num site estático em Git; está
// no WordPress. A REST API já vem ligada por padrão e a autenticação é por
// Application Password, gerada pelo próprio cliente no perfil dele. Nenhum
// plugin, nenhum código.
export const id = 'wordpress';

function authHeader({ username, applicationPassword }) {
  return 'Basic ' + Buffer.from(`${username}:${applicationPassword}`).toString('base64');
}

async function wp(config, path, options = {}) {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2${path}`, {
    ...options,
    headers: {
      authorization: authHeader(config),
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`WordPress ${res.status} em ${path}: ${body.slice(0, 300)}`);
    err.statusCode = res.status;
    throw err;
  }
  return res.json();
}

export async function healthCheck(config) {
  const me = await wp(config, '/users/me?context=edit');
  return { ok: true, user: me.name, canPublish: !!me.capabilities?.publish_posts };
}

/**
 * Idempotente por slug: se o post existe, atualiza; senão, cria.
 * `draft` do frontmatter mapeia direto para o status do WordPress — o gate
 * humano funciona sem nenhuma adaptação.
 */
export async function publish(config, { slug, title, excerpt, html, isDraft, publishedAt }) {
  const existing = await wp(config, `/posts?slug=${encodeURIComponent(slug)}&status=any&context=edit`);
  const payload = {
    slug, title, content: html, excerpt,
    status: isDraft ? 'draft' : 'publish',
    date_gmt: publishedAt.replace('Z', ''),
  };
  const post = existing.length
    ? await wp(config, `/posts/${existing[0].id}`, { method: 'POST', body: JSON.stringify(payload) })
    : await wp(config, '/posts', { method: 'POST', body: JSON.stringify(payload) });
  return { id: post.id, url: post.link, status: post.status };
}
